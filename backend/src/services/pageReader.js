// Reads web pages for DeepSearch.
//
// Search results carry a snippet of a few sentences, and that is too little to
// research with: the number, date or caveat that matters is usually further
// down the page. So DeepSearch reads the pages themselves. Tavily already
// returns each page's text; for results from the keyless fallbacks, pages are
// fetched here.
//
// Then, rather than handing whole pages to the writing model, the passages
// that bear on the question are picked out. That is done by term overlap, with
// no model call, so reading twenty pages costs no tokens and no time beyond
// the downloads.
//
// The URLs come from search results, i.e. from third parties, so every fetch
// goes only to public http(s) hosts and re-checks each redirect (the same
// guard the news-image reader uses), reads a bounded number of bytes and gives
// up quickly.

const dns = require("node:dns");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const zlib = require("node:zlib");
const { Readable } = require("node:stream");
const { assertPublicHttpUrl, isPrivateAddress } = require("./articleImages");

const MAX_PAGE_BYTES = 1500 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * A dns.lookup for sockets that refuses any answer that isn't a public
 * address. Given to the socket itself, so the address checked is the address
 * connected to: a name can't answer "public" to the check and "private" to
 * the connection (DNS rebinding).
 */
const isPublic = (address) => !isPrivateAddress(address);

function publicOnlyLookup({ resolve = dns.lookup, isAllowed = isPublic } = {}) {
  return (hostname, options, callback) => {
    const opts = options && typeof options === "object" ? options : { family: options };
    resolve(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : []).filter((a) => a?.address);
      if (!list.length || !list.every((a) => isAllowed(a.address))) {
        const refused = new Error(`${hostname} does not resolve to a public address`);
        refused.code = "ENONPUBLIC";
        return callback(refused);
      }
      return opts.all ? callback(null, list) : callback(null, list[0].address, list[0].family);
    });
  };
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * fetch() for third-party pages: a plain GET through node's http(s) with
 * publicOnlyLookup on the socket, decompressing the body, answered as a
 * standard Response. Redirects are not followed (fetchPageText follows them,
 * re-checking each).
 */
function guardedFetch(href, { signal, headers = {} } = {}, lookupOptions) {
  return new Promise((resolve, reject) => {
    const url = new URL(href);
    const client = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
    if (!client) return reject(new Error("unsupported protocol"));
    // Sockets don't look up an IP address, so the lookup can't vet one.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && !(lookupOptions?.isAllowed || isPublic)(literal)) {
      const refused = new Error(`${literal} is not a public address`);
      refused.code = "ENONPUBLIC";
      return reject(refused);
    }
    const request = client.request(url, {
      method: "GET",
      agent: false,
      signal,
      lookup: publicOnlyLookup(lookupOptions),
      headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
    }, (response) => {
      const encoding = String(response.headers["content-encoding"] || "").toLowerCase();
      const decoder = encoding.includes("gzip") ? zlib.createGunzip()
        : encoding === "deflate" ? zlib.createInflate()
        : encoding === "br" ? zlib.createBrotliDecompress()
        : null;
      const body = decoder ? response.pipe(decoder) : response;
      // A dropped connection mid-body must end the read, not crash the process.
      response.on("error", (err) => { if (decoder) decoder.destroy(err); });
      const headerList = Object.entries(response.headers)
        .filter(([name]) => name !== "set-cookie")
        .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((v) => [name, String(v)]));
      try {
        resolve(new Response(NULL_BODY_STATUS.has(response.statusCode) ? null : Readable.toWeb(body), {
          status: response.statusCode,
          headers: headerList,
        }));
      } catch (err) {
        response.destroy();
        reject(err);
      }
    });
    request.on("error", reject);
    request.end();
  });
}

async function readLimited(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetches a page and returns its readable text, or null when it can't be read
 * (non-public host, error status, not HTML or plain text, timeout, cancelled).
 */
async function fetchPageText(pageUrl, { fetchImpl = guardedFetch, lookup = dns.promises.lookup, timeoutMs = FETCH_TIMEOUT_MS, signal } = {}) {
  try {
    let current = pageUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (signal?.aborted) return null;
      const url = await assertPublicHttpUrl(current, lookup);
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(url.href, {
        redirect: "manual",
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VetroAI-Research/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location"), url).href;
        response.body?.cancel?.().catch(() => {});
        continue;
      }
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !/html|text\/plain/i.test(type)) {
        response.body?.cancel?.().catch(() => {});
        return null;
      }
      const body = await readLimited(response, MAX_PAGE_BYTES);
      const text = /html/i.test(type) ? htmlToText(body) : body.trim();
      return text.length >= 200 ? text : null;
    }
  } catch {
    return null;
  }
  return null;
}

// ── HTML to text ────────────────────────────────────────────────────────────
// Pages come from anywhere, so nothing here may take more than linear time on
// any input: every scan is an indexOf that moves forward, and every pattern
// stops at the next "<" rather than searching on to the end of the page (a
// page of unclosed "<!--" or "<nav>" made the regex version take minutes).

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®",
  trade: "™", deg: "°", euro: "€", pound: "£", rupee: "₹", middot: "·", bull: "•", times: "×",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const stripTags = (html) => html.replace(/<[^<>]*>/g, " ");

// Elements whose content is never the page's text.
const DROPPED = new Set(["script", "style", "noscript", "svg", "template", "iframe", "canvas", "form", "nav", "header", "footer", "aside", "select", "button"]);
const TAG_NAME = /^<([a-z][a-z0-9-]*)/;

/** The element name of a tag starting at `i` in `lower` ("<nav class=x>" -> "nav"), if any. */
function tagNameAt(lower, i) {
  const match = TAG_NAME.exec(lower.slice(i, i + 32));
  if (!match) return null;
  const next = lower[i + match[0].length];
  return next === undefined || next === ">" || next === "/" || /\s/.test(next) ? match[1] : null;
}

/** Removes comments and DROPPED elements, in one forward pass. */
function dropNoise(html) {
  const lower = html.toLowerCase();
  const unclosed = new Set(); // names with no closing tag anywhere further on
  let out = "";
  let i = 0;
  for (;;) {
    const lt = lower.indexOf("<", i);
    if (lt === -1) { out += html.slice(i); break; }
    if (lower.startsWith("<!--", lt)) {
      out += `${html.slice(i, lt)} `;
      const end = lower.indexOf("-->", lt + 4);
      if (end === -1) break; // an unterminated comment runs to the end, as in a browser
      i = end + 3;
      continue;
    }
    const name = tagNameAt(lower, lt);
    if (name && DROPPED.has(name) && !unclosed.has(name)) {
      const close = lower.indexOf(`</${name}`, lt + 1);
      if (close === -1) {
        unclosed.add(name); // so later ones of this name don't search again
      } else {
        out += `${html.slice(i, lt)} `;
        const gt = lower.indexOf(">", close);
        i = gt === -1 ? html.length : gt + 1;
        continue;
      }
    }
    out += html.slice(i, lt + 1);
    i = lt + 1;
  }
  return out;
}

/** The first <name>…</name> element (or from <name> to the end when unclosed), or null. */
function firstElement(html, lower, name) {
  for (let from = 0; ;) {
    const open = lower.indexOf(`<${name}`, from);
    if (open === -1) return null;
    if (tagNameAt(lower, open) === name) {
      const close = lower.indexOf(`</${name}`, open);
      return html.slice(open, close === -1 ? html.length : close);
    }
    from = open + 1;
  }
}

/**
 * Turns a page's HTML into plain text, keeping the line breaks that separate
 * paragraphs and list items, and dropping scripts, styles, menus, headers,
 * footers and forms. Prefers the page's <article> or <main> when it has one
 * with real content.
 */
function htmlToText(html) {
  let s = dropNoise(String(html || ""));
  const lower = s.toLowerCase();
  const bodyAt = lower.indexOf("<body");
  const body = bodyAt === -1 ? s : s.slice(bodyAt);
  const bodyLower = bodyAt === -1 ? lower : lower.slice(bodyAt);
  const main = firstElement(body, bodyLower, "article") || firstElement(body, bodyLower, "main");
  s = main && stripTags(main).replace(/\s+/g, " ").length > 800 ? main : body;

  s = s
    .replace(/<li\b[^<>]*>/gi, "\n• ")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<(br|hr)\b[^<>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|h[1-6]|ul|ol|tr|table|blockquote|pre|dd|dt|figcaption)\b[^<>]*>/gi, "\n");

  return decodeEntities(stripTags(s))
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line && line !== "•" && line !== "|")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Picking passages ────────────────────────────────────────────────────────
const STOPWORDS = new Set((
  "the and for are but not you all any can had her was one our out has have him his how its may new now old see two way who did get got let put say she too use what when where which while with from that this they them then than there these those will would could should about into over under after before also been being more most some such only very just your their what's whats does doing done each other many much here why how's latest current today best top vs versus explain tell give show find list"
).split(/\s+/));

/** The words worth matching on: lower-cased, 3+ letters or a number, no stopwords. */
function keyTerms(text) {
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.%-]*/gu) || [];
  const terms = new Set();
  for (let w of words) {
    w = w.replace(/[.-]+$/, "");
    if (/^\d+([.,]\d+)?%?$/.test(w) ? w.length >= 2 : w.length >= 3 && !STOPWORDS.has(w)) terms.add(w);
  }
  return terms;
}

/** Splits page text into passages of roughly paragraph size. */
function splitPassages(text, { target = 600, max = 1000 } = {}) {
  const blocks = String(text || "").split(/\n+/).map((b) => b.trim()).filter(Boolean);
  const passages = [];
  let current = "";
  const push = (p) => { if (p.trim().length >= 40) passages.push(p.trim()); };

  for (const block of blocks) {
    if (block.length > max) {
      push(current); current = "";
      // A wall of text: cut it at sentence ends.
      let piece = "";
      for (const sentence of block.split(/(?<=[.!?])\s+/)) {
        if (piece && piece.length + sentence.length > target) { push(piece); piece = ""; }
        piece += (piece ? " " : "") + sentence;
      }
      push(piece.slice(0, max));
      continue;
    }
    if (current && current.length + block.length > target) { push(current); current = ""; }
    current += (current ? "\n" : "") + block;
  }
  push(current);
  return passages.slice(0, 400);
}

/**
 * A page's passages with their terms worked out once. DeepSearch ranks each
 * page against several angles and claims, so it indexes a page once and
 * scores it many times (pickPassages).
 */
function indexPassages(text) {
  return splitPassages(text).map((passage, index) => ({
    passage,
    index,
    terms: keyTerms(passage),
    hasNumber: /\d/.test(passage),
  }));
}

function scoreIndexed(entry, terms) {
  if (!terms.size) return 0;
  let score = 0;
  for (const term of terms) {
    if (entry.terms.has(term)) score += /\d/.test(term) ? 1.5 : 1;
  }
  if (score && entry.hasNumber) score += 0.25;
  // Long passages match more words by size alone.
  return score / Math.sqrt(Math.max(entry.passage.length, 200) / 400);
}

/** How well a passage matches the question's terms. Numbers count extra: research usually turns on them. */
function scorePassage(passage, terms) {
  return scoreIndexed({ passage, terms: keyTerms(passage), hasNumber: /\d/.test(passage) }, terms);
}

/**
 * The passages of `text` that best match `terms`, in page order, within a
 * character budget. `score` is the best single passage's score.
 */
function bestPassages(text, terms, options) {
  return pickPassages(indexPassages(text), terms, options);
}

/** bestPassages for a page already indexed with indexPassages. */
function pickPassages(indexed, terms, { max = 3, maxChars = 1600 } = {}) {
  const scored = indexed
    .map((entry) => ({ passage: entry.passage, index: entry.index, score: scoreIndexed(entry, terms) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const p of scored) {
    if (picked.length >= max) break;
    const passage = p.passage.length > 900 ? `${p.passage.slice(0, 900)}…` : p.passage;
    if (used + passage.length > maxChars && picked.length) continue;
    picked.push({ ...p, passage });
    used += passage.length;
  }
  return {
    score: scored[0]?.score || 0,
    passages: picked.sort((a, b) => a.index - b.index).map((p) => p.passage),
  };
}

module.exports = { fetchPageText, guardedFetch, publicOnlyLookup, htmlToText, decodeEntities, keyTerms, splitPassages, scorePassage, bestPassages, indexPassages, pickPassages };
