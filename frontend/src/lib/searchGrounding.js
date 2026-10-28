// How a browser model's web search is aimed and how its results are used.
// Same rules as backend/src/services/searchGrounding.js (which explains the
// follow-up and blank-picture bugs behind them); keep the two in step.

export const GROUNDING_RULE = "Combine these results with what you reliably know. If they describe a change (someone took office, a product launched, a rule changed) and the question asks about a time before it, answer that earlier part from your own knowledge and say it comes from your own knowledge; never reply only that the sources don't say. Likewise, when the results lack stable reference data you know (climate averages, historical figures, census numbers, geography), give it from your own knowledge, labelled approximate, rather than refusing. Never write image galleries or visual_gallery blocks yourself: the app adds real pictures on its own.";

const FOLLOW_UP_START = /^\s*(then|and|also|so|but|or|what about|how about|same (for|in|with)|(in|for|before|after) \d{4})\b/i;
const LEANS_ON_CONTEXT = /\b(he|she|they|him|her|them|his|its|their|that one|this one|the same|then)\b/i;

/** The query to search for `question`, with the previous question added when it is a follow-up. */
export function searchQueryFor(question, history = []) {
  const q = String(question || "").trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  if (!q || words > 10 || !(FOLLOW_UP_START.test(q) || LEANS_ON_CONTEXT.test(q))) return q;
  const prev = [...history].reverse().find((m) =>
    m && m.role === "user" && typeof m.content === "string" && m.content.trim() && m.content.trim() !== q);
  if (!prev) return q;
  return `${prev.content.trim().replace(/\s+/g, " ").slice(0, 200)} — ${q}`;
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
