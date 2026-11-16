"use strict";

// Photos for the chat's picture gallery: "show me photos of Ooty", "what
// does a quokka look like", "who is …" (AIOrchestrator IMAGE_TRIGGERS).
//
// The gallery used to come from Tavily alone. When Tavily found nothing (no
// key, its quota used up, a slow answer), no photos appeared and the model
// listed links to pictures instead. Now every source is asked at once and
// the gallery takes the best of them, in this order:
//   1. Tavily's images for the search, when it has a key;
//   2. Wikipedia's lead photo for the subject (people, places, animals,
//      things with an article): keyless, and almost always the right one;
//   3. Pexels stock photos (PEXELS_API_KEY);
//   4. Wikimedia Commons photos (keyless);
//   5. Openverse (keyless, slowest), only when the rest found too few.
// The searches run while the answer is being written, so they add no wait.

const sites = require("./siteImageService");
const logger = require("../utils/logger");

const WIKI_TIMEOUT_MS = 5000;

/**
 * The thing to find photos of: "show me some photos of Ooty lake" → "Ooty
 * lake", "what does a quokka look like" → "a quokka", "who is Sachin
 * Tendulkar" → "Sachin Tendulkar".
 */
function imageSubject(query) {
  let q = String(query || "").trim();
  q = q.replace(/^(?:(?:hey|hi|hello|please|pls|ok|okay)[\s,!]+)+/i, "");
  q = q.replace(/^(?:can|could|would|will) you\s+/i, "");
  q = q.replace(/^(?:please\s+)?(?:show|give|find|get|send|display)\s+(?:me\s+)?(?:some\s+|a few\s+|a\s+|an\s+|the\s+)?(?:real\s+|nice\s+|good\s+)?(?:photos?|pictures?|pics?|images?)\s+(?:of|from|for)\s+/i, "");
  q = q.replace(/^(?:some\s+)?(?:photos?|pictures?|pics?|images?)\s+(?:of|from|for)\s+/i, "");
  q = q.replace(/^what (?:does|do|did) (.+?) look like\b.*$/i, "$1");
  q = q.replace(/^how (?:does|do|did) (.+?) look\b.*$/i, "$1");
  q = q.replace(/^(?:who|what) (?:is|was|are|were)\s+/i, "");
  q = q.replace(/\s+(?:photos?|pictures?|pics?|images?)$/i, "");
  q = q.replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
  return q || String(query || "").trim();
}

/** Wikipedia's lead photos for the top articles about `subject`. */
async function searchWikipedia(subject, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrsearch: subject, gsrlimit: "4",
    prop: "pageimages", piprop: "thumbnail", pithumbsize: "900",
  });
  const res = await fetchImpl(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "VetroAI/1.0 (chat photos)" },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .filter((page) => page?.thumbnail?.source && !/\.svg/i.test(page.thumbnail.source))
    .map((page) => ({ url: page.thumbnail.source, caption: page.title }));
}

const asItems = (caption) => (urls) => (urls || []).map((url) => ({ url, caption }));
const quietly = (name, promise) => promise.catch((err) => {
  logger.warn("photoSearch.sourceFailed", { source: name, error: err?.message });
  return [];
});

/**
 * Up to `limit` photos of what `query` asks to see, as [{ url, caption }].
 * `tavilyImages(subject)` is Tavily's image search (searchController);
 * the other sources can be replaced in tests through `sources`.
 */
async function findPhotos(query, { limit = 4, tavilyImages = async () => [], sources = {} } = {}) {
  const subject = imageSubject(query);
  if (!subject) return [];
  const clean = sites.cleanQuery(subject);
  const wikipedia = sources.wikipedia || ((s) => searchWikipedia(s));
  const pexels = sources.pexels || ((s) => sites.searchPexels(s, "landscape"));
  const commons = sources.commons || ((s) => sites.searchCommons(s, "landscape"));
  const openverse = sources.openverse || ((s) => sites.searchOpenverse(s, "landscape"));

  const [fromTavily, fromWikipedia, fromPexels, fromCommons] = await Promise.all([
    quietly("tavily", Promise.resolve().then(() => tavilyImages(subject))),
    quietly("wikipedia", Promise.resolve().then(() => wikipedia(subject))),
    quietly("pexels", Promise.resolve().then(() => pexels(clean)).then(asItems(subject))),
    quietly("commons", Promise.resolve().then(() => commons(clean)).then(asItems(subject))),
  ]);

  const found = [];
  const add = (items) => {
    for (const item of items || []) {
      if (found.length >= limit) return;
      if (!/^https:\/\//i.test(String(item?.url || "")) || found.some((f) => f.url === item.url)) continue;
      found.push({ url: item.url, caption: item.caption || subject });
    }
  };
  add(fromTavily);
  // The article's own photo, then one more from it, then stock and Commons.
  add(fromWikipedia.slice(0, 2));
  add(fromPexels);
  add(fromCommons);
  if (found.length < 2) add(await quietly("openverse", Promise.resolve().then(() => openverse(clean)).then(asItems(subject))));
  logger.info("photoSearch.found", { subject, count: found.length });
  return found;
}

module.exports = { findPhotos, imageSubject, searchWikipedia };
