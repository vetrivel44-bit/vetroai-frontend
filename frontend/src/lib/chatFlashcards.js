// A ```flashcards block: a study deck the chat plays as flip cards. The model
// writes JSON; the chat shows one card at a time, the learner flips it, marks
// it "Got it" or "Still learning", and can then review only the ones they
// missed.
//
// {"title": "Cell biology", "cards": [
//    {"front": "Mitochondria", "back": "Makes the cell's energy (ATP)",
//     "hint": "the cell's power station", "example": "…"}]}
//
// Models drift on field names, so question/answer, term/definition, q/a and a
// bare array of cards are all accepted.

import { parseLooseJson } from "./looseJson.js";

export const MAX_CARDS = 60;

const text = (v) => (v == null ? "" : String(v).trim());
const first = (obj, keys) => {
  for (const k of keys) {
    const v = text(obj?.[k]);
    if (v) return v;
  }
  return "";
};

const FRONT_KEYS = ["front", "term", "question", "q", "prompt", "word", "concept"];
const BACK_KEYS = ["back", "definition", "answer", "a", "meaning", "explanation"];

/** True when `card` looks like a flashcard (has a front and a back). */
export function isCardLike(card) {
  return Boolean(card && typeof card === "object" && !Array.isArray(card.options)
    && first(card, FRONT_KEYS) && first(card, BACK_KEYS));
}

export function parseFlashcards(code) {
  const data = typeof code === "string" ? parseLooseJson(code) : code;
  const list = Array.isArray(data) ? data : (data?.cards || data?.flashcards || data?.deck);
  if (!Array.isArray(list) || !list.length) throw new Error("no cards");
  const cards = list.slice(0, MAX_CARDS).map((c, i) => {
    const front = first(c, FRONT_KEYS);
    const back = first(c, BACK_KEYS);
    if (!front) throw new Error(`card ${i + 1} has no front`);
    if (!back) throw new Error(`card ${i + 1} has no back`);
    return { id: i, front, back, hint: text(c.hint), example: text(c.example) };
  });
  const title = Array.isArray(data) ? "" : text(data?.title);
  return { title: title || "Flashcards", cards };
}

/** Fisher–Yates on a copy; `random` is injectable for tests. */
export function shuffled(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Tab-separated front/back lines: imports straight into Anki or Quizlet. */
export function deckToTsv(deck) {
  const clean = (s) => String(s || "").replace(/[\t\r\n]+/g, " ").trim();
  return deck.cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`).join("\n") + "\n";
}

export function deckSummary(total, known) {
  const percent = total ? Math.round((known / total) * 100) : 0;
  let verdict;
  if (percent === 100) verdict = "You know every card. Brilliant!";
  else if (percent >= 75) verdict = "Nearly there. Review the few you missed.";
  else if (percent >= 40) verdict = "Good progress. Another round will lock these in.";
  else verdict = "Keep going. Repetition is how these stick.";
  return { total, known, learning: total - known, percent, verdict };
}
