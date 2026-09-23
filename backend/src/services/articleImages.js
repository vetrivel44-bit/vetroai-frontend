// Fills in a picture for news articles the provider sent without one.
//
// Most outlets publish a preview image for every article (the Open Graph
// `og:image` tag link previews use), so when the feed leaves `image_url`
// empty we read that tag from the article page itself. The result is the
// outlet's own photo for the story rather than a placeholder.
//
// The article URLs come from a third-party feed, so every fetch is limited to
// public http(s) hosts (no loopback / private / link-local addresses), follows
// at most a few redirects (each re-checked), reads only the start of the page
// and gives up quickly. The whole fill has a time budget so a slow outlet can
// never hold up the news response.

//
// Some outlets refuse our fetch (bot protection, JavaScript-only pages). When
// FIRECRAWL_API_KEY is set, those articles are opened through Firecrawl's
// scraper instead, which gets past most of that, and its page metadata gives
// the same og:image. That costs a Firecrawl credit, so it only runs when our
// own fetch found nothing, and every result (including "no image") is cached.

const dns = require("node:dns").promises;
const net = require("node:net");
const { config } = require("../config/env");
const logger = require("../utils/logger");

const MAX_HTML_BYTES = 350 * 1024;
const FETCH_TIMEOUT_MS = 3500;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 800;

const FIRECRAWL_TIMEOUT_MS = 15000;

const cache = new Map(); // url -> { image: string|null, at: number }
// Lookups still running, so the feed-wide fill and a card's own preview
// request for the same article share one fetch (and one Firecrawl credit).
const inflight = new Map();

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(url); return undefined; }
  return hit.image;
}

function cacheSet(url, image) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, { image, at: Date.now() });
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe[89ab])/.test(v6);
}

async function assertPublicHttpUrl(rawUrl, lookup = dns.lookup) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  if (url.username || url.password) throw new Error("credentials in url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("non-public host");
  }
  return url;
}

const decodeEntities = (text) => text
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/gi, "/");

// Pulls the article's preview image out of its HTML. Pure, so it is tested
// directly without any network.
function extractImageFromHtml(html, pageUrl) {
  const head = String(html || "").slice(0, MAX_HTML_BYTES);
  const wanted = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  const found = {};

  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!key || !content) continue;
    const k = key.toLowerCase();
    if (wanted.includes(k) && !found[k]) found[k] = content;
    if (k === "image" && !found.itemprop) found.itemprop = content;
  }
  const linkTag = (head.match(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i) || [])[0];
  if (linkTag) found.image_src = (linkTag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];

  for (const key of [...wanted, "itemprop", "image_src"]) {
    const value = found[key];
    if (!value) continue;
    try {
      const resolved = new URL(decodeEntities(value.trim()), pageUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") return resolved.href;
    } catch { /* malformed — try the next candidate */ }
  }
  return null;
}

async function readLimited(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      // The tags live in <head>; stop as soon as it has been read.
      if (Buffer.from(value).includes("</head>")) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

// Our own fetch. `isPublic` says the URL passed the public-host check, so
// it is fine to hand to Firecrawl when we found no image ourselves.
async function fetchOwnImage(articleUrl, fetchImpl, lookup) {
  let image = null;
  let isPublic = false;
  try {
    let current = articleUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicHttpUrl(current, lookup);
      if (hop === 0) isPublic = true;
      const response = await fetchImpl(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VetroAI-LinkPreview/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location"), url).href;
        response.body?.cancel?.().catch(() => {});
        continue;
      }
      const type = response.headers.get("content-type") || "";
      if (response.ok && /html/i.test(type)) image = extractImageFromHtml(await readLimited(response), url.href);
      else response.body?.cancel?.().catch(() => {});
      break;
    }
  } catch {
    image = null;
  }
  return { image, isPublic };
}

// Opens the article through Firecrawl's scraper and reads the preview image
// from the page metadata it returns.
async function firecrawlImage(articleUrl, { fetchImpl, apiKey }) {
  const response = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: articleUrl, formats: ["markdown"], onlyMainContent: true, timeout: FIRECRAWL_TIMEOUT_MS - 3000 }),
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
  });
  if (!response.ok) {
    // 401/402 here mean the key or the Firecrawl credits — worth seeing in the logs.
    logger.warn("articleImages.firecrawlFailed", { status: response.status });
    return null;
  }
  const meta = (await response.json().catch(() => null))?.data?.metadata || {};
  const candidates = [meta.ogImage, meta["og:image"], meta.ogImageSecureUrl, meta.twitterImage, meta["twitter:image"]].flat();
  for (const value of candidates) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const resolved = new URL(value.trim(), articleUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") return resolved.href;
    } catch { /* malformed — try the next one */ }
  }
  return null;
}

async function findArticleImage(articleUrl, { fetchImpl = fetch, lookup = dns.lookup, firecrawlApiKey = config.firecrawlApiKey } = {}) {
  if (!articleUrl) return null;
  const cached = cacheGet(articleUrl);
  if (cached !== undefined) return cached;
  if (inflight.has(articleUrl)) return inflight.get(articleUrl);

  const lookupPromise = (async () => {
    const { image, isPublic } = await fetchOwnImage(articleUrl, fetchImpl, lookup);
    let result = image;
    if (!result && isPublic && firecrawlApiKey) {
      result = await firecrawlImage(articleUrl, { fetchImpl, apiKey: firecrawlApiKey }).catch(() => null);
    }
    cacheSet(articleUrl, result);
    return result;
  })().finally(() => inflight.delete(articleUrl));
  inflight.set(articleUrl, lookupPromise);
  return lookupPromise;
}

// Fills `image_url` on articles that lack one, in place, within `budgetMs`.
// Articles still missing an image when the budget runs out are left as they
// are (and their lookups keep running into the cache for the next request).
async function fillMissingImages(articles, { budgetMs = 4000, concurrency = 6, max = 20, ...options } = {}) {
  const missing = (articles || []).filter((a) => a && !a.image_url && a.link).slice(0, max);
  if (!missing.length) return articles;

  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const article = missing[next++];
      const image = await findArticleImage(article.link, options);
      if (image) article.image_url = image;
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, budgetMs).unref?.())]);
  return articles;
}

module.exports = { extractImageFromHtml, findArticleImage, fillMissingImages, isPrivateAddress, _cache: cache };
