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

const dns = require("node:dns").promises;
const { assertPublicHttpUrl } = require("./articleImages");

const MAX_PAGE_BYTES = 1500 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

// ── Fetching ────────────────────────────────────────────────────────────────
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
 * (non-public host, error status, not HTML or plain text, timeout).
 */
async function fetchPageText(pageUrl, { fetchImpl = fetch, lookup = dns.lookup, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    let current = pageUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicHttpUrl(current, lookup);
      const response = await fetchImpl(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
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
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®",
  trade: "™", deg: "°", euro: "€", pound: "£", rupee: "₹", middot: "·", bull: "•", times: "×",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const stripTags = (html) => html.replace(/<[^>]+>/g, " ");

/**
 * Turns a page's HTML into plain text, keeping the line breaks that separate
 * paragraphs and list items, and dropping scripts, styles, menus, headers,
 * footers and forms. Prefers the page's <article> or <main> when it has one
 * with real content.
 */
function htmlToText(html) {
  let s = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|nav|header|footer|aside|select|button)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const body = s.match(/<body\b[\s\S]*$/i)?.[0] || s;
  const main = body.match(/<article\b[\s\S]*?<\/article\s*>/i)?.[0] || body.match(/<main\b[\s\S]*?<\/main\s*>/i)?.[0];
  s = main && stripTags(main).replace(/\s+/g, " ").length > 800 ? main : body;

  s = s
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|h[1-6]|ul|ol|tr|table|blockquote|pre|dd|dt|figcaption)\b[^>]*>/gi, "\n");

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

module.exports = { fetchPageText, htmlToText, decodeEntities, keyTerms, splitPassages, scorePassage, bestPassages, indexPassages, pickPassages };
