// How a browser model's web search is aimed and how its results are used.
// Same rules as backend/src/services/searchGrounding.js (which explains the
// follow-up and blank-picture bugs behind them); keep the two in step.

export const GROUNDING_RULE = "Give one accurate, complete, confident answer: cross-check the results with each other and with what you reliably know; where a result is wrong or contradicts the established record, use the correct facts and never repeat its mistakes. When the results are thin or partial, complete the answer from your own knowledge (full lists, every figure; reference data such as climate averages and history); never reply only that the sources don't say. No notes on source quality and no telling the user to verify elsewhere. Never write image galleries or visual_gallery blocks yourself: the app adds real pictures on its own.";

// Said with every set of search results: a follow-up is read in the
// conversation, and results about something else are left out.
export const FOLLOW_UP_NOTE = "This message continues the conversation above: read it in that context — \"it\", \"this movie\", \"he\", \"total\" and the like refer to what was just being discussed. If these results are about a different subject (another film, person or product with a similar name), ignore them and answer about the subject of the conversation from the earlier replies and what you know, saying that live results weren't found for it.";

// Short messages that lean on the one before: "then in 2025?", "what about
// him", "and the price?", "is the reviews good for this movie", "Total".
// "Ramayana collection till now" → "Total" → "Is the reviews good for this
// movie" was searched on its own and answered with reviews of another film:
// "this movie" wasn't on the list, and the message before it ("Total") was a
// follow-up too, so adding just that one didn't name the film either.
const FOLLOW_UP_START = /^\s*(then|and|also|so|but|or|what about|how about|same (for|in|with)|(in|for|before|after) \d{4}|(is|was|are|were|does|did|do|has|have|can|will) (it|this|that|they|these|those|he|she)\b)/i;
const LEANS_ON_CONTEXT = /\b(he|she|they|him|her|them|his|hers|its|it|their|theirs|this|that|these|those|there|the same|then|that one|this one|same one)\b/i;
// How many earlier questions to look back through for the one that names the topic.
const ANCHOR_LOOKBACK = 4;

/** Does `question` lean on an earlier message for its subject? */
export function leansOnContext(question) {
  const q = String(question || "").trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (!q || words.length > 12) return false;
  // One bare word ("Total", "cast?", "reviews") only makes sense in context.
  if (words.length === 1 && !/\d/.test(q)) return true;
  return FOLLOW_UP_START.test(q) || LEANS_ON_CONTEXT.test(q);
}

/** The query to search for `question`, with the earlier question that names its topic when it is a follow-up. */
export function searchQueryFor(question, history = []) {
  const q = String(question || "").trim();
  if (!leansOnContext(q)) return q;
  const asked = [...(Array.isArray(history) ? history : [])].reverse().filter((m) =>
    m && m.role === "user" && typeof m.content === "string" && m.content.trim() && m.content.trim() !== q);
  if (!asked.length) return q;
  // Back past earlier follow-ups ("Total") to the question that named the topic.
  const anchor = asked.slice(0, ANCHOR_LOOKBACK).find((m) => !leansOnContext(m.content)) || asked[0];
  return `${anchor.content.trim().replace(/\s+/g, " ").slice(0, 200)} — ${q}`;
}

// A gallery picture must be an actual image, not a web page: models have
// filled galleries with facebook.com/…/posts and wikipedia.org/wiki links.
const PAGE_URL = /(facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|reddit\.com)\/|wikipedia\.org\/wiki\/|\.(html?|php|aspx?)(\?|#|$)|news\.php/i;
const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

export function isLikelyImageUrl(url) {
  const u = String(url || "").trim();
  if (/^data:image\//i.test(u)) return true;
  if (!/^https?:\/\//i.test(u)) return false;
  if (IMAGE_URL.test(u)) return true;
  return !PAGE_URL.test(u);
}
