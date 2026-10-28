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

// Short messages that lean on the one before: "then in 2025?", "what about
// him", "and the price?".
const FOLLOW_UP_START = /^\s*(then|and|also|so|but|or|what about|how about|same (for|in|with)|(in|for|before|after) \d{4})\b/i;
const LEANS_ON_CONTEXT = /\b(he|she|they|him|her|them|his|its|their|that one|this one|the same|then)\b/i;

/** The query to search for `question`, with the previous question added when it is a follow-up. */
function searchQueryFor(question, history = []) {
  const q = String(question || "").trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  if (!q || words > 10 || !(FOLLOW_UP_START.test(q) || LEANS_ON_CONTEXT.test(q))) return q;
  const prev = [...history].reverse().find((m) =>
    m && m.role === "user" && typeof m.content === "string" && m.content.trim() && m.content.trim() !== q);
  if (!prev) return q;
  return `${prev.content.trim().replace(/\s+/g, " ").slice(0, 200)} — ${q}`;
}

// The ```json {"type": "visual_gallery", …} ``` blocks the app appends to replies.
const GALLERY_BLOCK = /```json[^\n]*\n(?:(?!```)[\s\S])*?"type"\s*:\s*"visual_gallery"(?:(?!```)[\s\S])*```\n?/g;

/** `text` without its picture galleries, so a model never sees one to copy. */
function stripGalleryBlocks(text) {
  return typeof text === "string" ? text.replace(GALLERY_BLOCK, "").trim() : text;
}

module.exports = { GROUNDING_RULE, searchQueryFor, stripGalleryBlocks };
