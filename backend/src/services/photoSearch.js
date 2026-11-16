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

// What Wikipedia's short description of a person says ("Indian actress
// (born 1985)", "American singer-songwriter", "Indian cricketer").
const PERSON = /\b(?:actor|actress|singer|songwriter|rapper|musician|composer|dancer|model|politician|president|prime minister|minister|chief minister|governor|king|queen|prince|princess|monarch|cricketer|footballer|athlete|player|sprinter|boxer|wrestler|tennis|golfer|chess|director|filmmaker|producer|screenwriter|writer|author|poet|novelist|journalist|anchor|presenter|host|comedian|youtuber|influencer|businessman|businesswoman|entrepreneur|executive|ceo|founder|investor|scientist|physicist|chemist|mathematician|engineer|activist|philosopher|saint|guru|religious leader|chef|designer|artist|painter|sculptor|photographer|astronaut|soldier|general|judge|lawyer|doctor|celebrity|personality|socialite|(?:born \d{4})|\(born\b|\(\d{4}[–-])/i;

// Two spellings of the same word: "agarwal" / "aggarwal", "shahrukh" /
// "shah". Doubled letters are one, then a couple of letters may differ.
const single = (w) => w.replace(/(.)\1+/g, "$1");
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}
function similar(a, b) {
  const x = single(a);
  const y = single(b);
  if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))) return true;
  return Math.min(x.length, y.length) >= 4 && editDistance(x, y) <= (Math.max(x.length, y.length) >= 7 ? 2 : 1);
}

/**
 * Is `subject` a real person, by the Wikipedia article it best matches?
 * { person, name, description }. Asked to make a picture of a real person,
 * the app shows real photos of them instead (frontend imageRequest.js).
 */
async function aboutPerson(subject, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrsearch: subject, gsrlimit: "1",
    prop: "description", redirects: "1",
  });
  const res = await fetchImpl(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "VetroAI/1.0 (chat photos)" },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const page = Object.values((await res.json())?.query?.pages || {})[0];
  if (!page?.title) return { person: false, name: subject, description: "" };
  // The article has to be about the subject asked for: most of its words are
  // in the title ("kajal agarwal" ~ "Kajal Aggarwal"), so a search that lands
  // on something else doesn't count.
  const asked = sites.cleanQuery(subject).split(" ").filter((w) => w.length > 1);
  const titleWords = sites.cleanQuery(page.title).split(" ");
  const near = (w) => titleWords.some((t) => similar(t, w));
  const matches = asked.filter(near).length >= Math.max(1, Math.ceil(asked.length * 0.6));
  const description = String(page.description || "");
  return { person: matches && PERSON.test(description), name: matches ? page.title : subject, description };
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

module.exports = { findPhotos, imageSubject, searchWikipedia, aboutPerson };
