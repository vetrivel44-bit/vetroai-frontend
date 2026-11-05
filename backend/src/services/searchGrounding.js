// How a turn's web search is aimed and how its results are used.
//
// "who is the cm of tn" then "then cm of tn in 2025 ?" went wrong twice:
//   - the follow-up was searched on its own, without the question it follows;
//   - the results were all about the May 2026 swearing-in, and the model,
//     told to answer from them, said the sources "do not name" the 2025 CM
//     instead of saying what it knows.
// It also copied the picture gallery the app had added to an earlier reply,
// filling it with web-page links that showed up as blank pictures.
//
// frontend/src/lib/searchGrounding.js carries the same rules for browser
// models; keep the two in step.

const GROUNDING_RULE = "Combine these results with what you reliably know. If they describe a change (someone took office, a product launched, a rule changed) and the question asks about a time before it, answer that earlier part from your own knowledge and say it comes from your own knowledge; never reply only that the sources don't say. Likewise, when the results lack stable reference data you know (climate averages, historical figures, census numbers, geography), give it from your own knowledge, labelled approximate, rather than refusing. Never write image galleries or visual_gallery blocks yourself: the app adds real pictures on its own.";

// Said with every set of search results: a follow-up is read in the
// conversation, and results about something else are left out.
const FOLLOW_UP_NOTE = "This message continues the conversation above: read it in that context — \"it\", \"this movie\", \"he\", \"total\" and the like refer to what was just being discussed. If these results are about a different subject (another film, person or product with a similar name), ignore them and answer about the subject of the conversation from the earlier replies and what you know, saying that live results weren't found for it.";

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
function leansOnContext(question) {
  const q = String(question || "").trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (!q || words.length > 12) return false;
  // One bare word ("Total", "cast?", "reviews") only makes sense in context.
  if (words.length === 1 && !/\d/.test(q)) return true;
  return FOLLOW_UP_START.test(q) || LEANS_ON_CONTEXT.test(q);
}

/** The query to search for `question`, with the earlier question that names its topic when it is a follow-up. */
function searchQueryFor(question, history = []) {
  const q = String(question || "").trim();
  if (!leansOnContext(q)) return q;
  const asked = [...(Array.isArray(history) ? history : [])].reverse().filter((m) =>
    m && m.role === "user" && typeof m.content === "string" && m.content.trim() && m.content.trim() !== q);
  if (!asked.length) return q;
  // Back past earlier follow-ups ("Total") to the question that named the topic.
  const anchor = asked.slice(0, ANCHOR_LOOKBACK).find((m) => !leansOnContext(m.content)) || asked[0];
  return `${anchor.content.trim().replace(/\s+/g, " ").slice(0, 200)} — ${q}`;
}

// The ```json {"type": "visual_gallery", …} ``` blocks the app appends to replies.
const GALLERY_BLOCK = /```json[^\n]*\n(?:(?!```)[\s\S])*?"type"\s*:\s*"visual_gallery"(?:(?!```)[\s\S])*```\n?/g;

/** `text` without its picture galleries, so a model never sees one to copy. */
function stripGalleryBlocks(text) {
  return typeof text === "string" ? text.replace(GALLERY_BLOCK, "").trim() : text;
}

module.exports = { GROUNDING_RULE, FOLLOW_UP_NOTE, leansOnContext, searchQueryFor, stripGalleryBlocks };
