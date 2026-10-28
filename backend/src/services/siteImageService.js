const config = require("../config/env");
const logger = require("../utils/logger");

// Pictures for websites the AI builds (Computer mode, Design). The page asks
// for a subject — "red running shoes", "barista pouring latte art" — and gets
// a photo of that, instead of picsum.photos' random animals and flowers on a
// shoe shop.
//
// Sources, best first: Pexels when PEXELS_API_KEY is set (curated stock
// photos, best match quality), then Wikimedia Commons (keyless, fast, real
// photos of most products and places), then Openverse (keyless, openly
// licensed, but often slow or down). When none answers, the route draws a
// soft gradient placeholder labelled with the subject (placeholderSvg), so a
// page never shows a broken image. LoremFlickr used to be that last step,
// but it went down and broke every picture on every generated site.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const LOOKUP_TIMEOUT_MS = 5000;
const cache = new Map();

const clampSize = (value, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 16 ? Math.min(n, 2400) : fallback;
};

// "Red Running-Shoes!!" → "red running shoes"; keeps letters in any script.
function cleanQuery(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/[-\s]+/g, " ")
    .trim()
    .slice(0, 80);
}

function orientationOf(width, height) {
  if (width > height * 1.15) return "landscape";
  if (height > width * 1.15) return "portrait";
  return "square";
}

// Stable choice per (query, size, index), so a page that reloads shows the
// same pictures, while two cards asking for "sneakers" can differ by index.
function pick(list, seed) {
  if (!list.length) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

async function fetchJson(url, headers = {}, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchPexels(query, orientation) {
  const key = config.pexelsApiKey || process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${orientation}`;
  const data = await fetchJson(url, { Authorization: key });
  return (data?.photos || [])
    .map((p) => p?.src?.large2x || p?.src?.large || p?.src?.original)
    .filter(Boolean);
}

async function searchOpenverse(query, orientation) {
  const aspect = orientation === "landscape" ? "wide" : orientation === "portrait" ? "tall" : "square";
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20&aspect_ratio=${aspect}&size=medium,large&mature=false`;
  // Short wait: Openverse is the last source and is often slow or down, and
  // every image on the page is held until this answers.
  const data = await fetchJson(url, { "User-Agent": "VetroAI/1.0 (site image lookup)" }, 2500);
  return (data?.results || [])
    // Originals can be huge scans; keep photos a page can load quickly.
    .filter((r) => r?.url && /^https:\/\//.test(r.url) && (!r.width || r.width <= 4000) && (!r.filetype || /jpe?g|png|webp/i.test(r.filetype)))
    .map((r) => r.url);
}

// Words that describe the shot rather than the subject; they only make a
// literal file-name search miss ("white sneakers product photo").
const SHOT_WORDS = new Set(["photo", "photos", "photograph", "image", "picture", "product", "shot", "view",
  "side", "front", "top", "close", "closeup", "up", "studio", "high", "quality", "hd", "background", "of", "a", "the", "and", "with", "on", "in"]);

function subjectWords(query) {
  return query.split(" ").filter((w) => w && !SHOT_WORDS.has(w));
}

// Commons' search matches loosely ("gold smart watch" finds an old book that
// mentions gold), so a photo counts only when its file name shares at least
// half of the subject's words (by 4-letter stem, so "sneakers" ~ "sneaker").
function titleMatches(title, words) {
  const t = String(title || "").toLowerCase();
  const hits = words.filter((w) => t.includes(w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w)).length;
  return hits >= Math.max(1, Math.ceil(words.length / 2));
}

async function commonsQuery(words, orientation) {
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6",
    gsrsearch: `${words.join(" ")} filetype:bitmap`, gsrlimit: "30",
    prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "1280",
  });
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, {
    "User-Agent": "VetroAI/1.0 (site image lookup)",
  });
  const photos = Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .filter((p) => titleMatches(p.title, words))
    .map((p) => p?.imageinfo?.[0])
    .filter((ii) => ii?.thumburl && /jpe?g|png|webp/i.test(ii.mime || "") && (ii.width || 0) >= 400);
  // Only pictures already in the slot's shape, when there are any, so a wide
  // hero isn't a cropped-to-nothing portrait.
  const fitting = photos.filter((ii) => orientationOf(ii.width, ii.height) === orientation);
  return (fitting.length ? fitting : photos).map((ii) => ii.thumburl);
}

// Commons serves a resized thumbnail for any width we ask, so pages load
// quickly; "filetype:bitmap" leaves out diagrams, maps and PDFs. When the full
// subject finds nothing, the last two words (usually the thing itself: "smart
// watch", "leather handbag") get one more try.
async function searchCommons(query, orientation) {
  const words = subjectWords(query);
  if (!words.length) return [];
  const urls = await commonsQuery(words, orientation);
  if (urls.length || words.length <= 2) return urls;
  return commonsQuery(words.slice(-2), orientation);
}

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * A soft gradient image labelled with the subject, for when no photo source
 * answers. The hue comes from the subject, so a page's placeholders vary.
 */
function placeholderSvg({ q, w, h } = {}) {
  const width = clampSize(w, 1200);
  const height = clampSize(h, 800);
  const label = cleanQuery(q) || "image";
  let hue = 0;
  for (const ch of label) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const size = Math.max(12, Math.min(width, height) / 14);
  const icon = Math.min(width, height) / 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},55%,92%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,82%)"/>`
    + `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`
    + `<g transform="translate(${width / 2 - icon / 2},${height / 2 - icon * 0.9}) scale(${icon / 24})" fill="none" stroke="hsl(${hue},30%,45%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".55">`
    + `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></g>`
    + `<text x="50%" y="${height / 2 + size * 1.6}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="${size}" fill="hsl(${hue},30%,35%)" opacity=".75">${escapeXml(label)}</text></svg>`;
}

async function lookup(query, orientation) {
  const key = `${orientation}:${query}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.urls;

  const pending = (async () => {
    for (const [name, search] of [["pexels", searchPexels], ["commons", searchCommons], ["openverse", searchOpenverse]]) {
      try {
        const urls = await search(query, orientation);
        if (urls.length) return urls;
      } catch (err) {
        logger.warn("siteImage.lookupFailed", { source: name, query, error: err.message });
      }
    }
    return [];
  })();
  // Concurrent requests for the same subject share one lookup.
  cache.set(key, { urls: pending, expires: Date.now() + CACHE_TTL_MS });
  const urls = await pending;
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  // A failed lookup is retried soon rather than cached for a day.
  cache.set(key, { urls, expires: Date.now() + (urls.length ? CACHE_TTL_MS : 5 * 60 * 1000) });
  return urls;
}

/**
 * The URL of a photo of `q`, sized about `w`×`h`, or null when no source
 * has one (the route then serves placeholderSvg). Never throws.
 */
async function findSiteImage({ q, w, h, i } = {}) {
  const width = clampSize(w, 1200);
  const height = clampSize(h, 800);
  const query = cleanQuery(q) || "abstract background";
  const seed = `${query}|${width}x${height}|${i ?? ""}`;
  const urls = await lookup(query, orientationOf(width, height)).catch(() => []);
  return pick(urls, seed);
}

function clearCache() { cache.clear(); }

module.exports = { findSiteImage, placeholderSvg, cleanQuery, orientationOf, clearCache };
