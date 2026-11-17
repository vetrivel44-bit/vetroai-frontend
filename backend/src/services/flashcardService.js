"use strict";

// Flashcards from an answer, for spaced-repetition study (the app brings each
// card back after a day, three days, a week… just before it would be
// forgotten: frontend lib/flashcards.js).
//
// Good cards ask one thing each, about something that matters in the answer,
// and the back answers it fully but briefly. The model is shown that, asked
// for plain JSON, and whatever comes back is checked and tidied here: a card
// with an empty side, a front that is a heading rather than a question, or a
// repeat is dropped.

const MAX_SOURCE_CHARS = 9000;
const MAX_CARDS = 12;
const FRONT_CHARS = 220;
const BACK_CHARS = 420;

function buildPrompt({ text, topic = "" }) {
  const system = [
    "You make study flashcards from a piece of writing, for spaced-repetition review.",
    "Rules:",
    "- 4 to 10 cards, as many as the writing has distinct ideas worth remembering; fewer for a short answer.",
    "- Each front is one clear question or prompt (under 20 words) that makes the learner recall one fact, idea, step, definition, formula or reason.",
    "- Each back answers it completely in one or two short sentences (under 35 words). No \"See above\".",
    "- Test understanding, not wording: no cards about the title, the order of sections, or who wrote it.",
    "- Cover the most important points first. No two cards ask the same thing.",
    "- Write in the same language as the writing. Plain text: no markdown, no numbering.",
    "Reply with only JSON: {\"deck\":\"a short name for the topic (2-5 words)\",\"cards\":[{\"front\":\"…\",\"back\":\"…\"}]}",
  ].join("\n");
  const user = `${topic ? `The question this answered: ${String(topic).slice(0, 300)}\n\n` : ""}The writing:\n${String(text).slice(0, MAX_SOURCE_CHARS)}`;
  return { system, user };
}

// Markdown and leftovers a model leaves on a side of a card.
const tidy = (value, max) => String(value || "")
  .replace(/\*\*|__|`/g, "")
  .replace(/^\s*(?:Q|A|Question|Answer|Front|Back)\s*[:.)-]\s*/i, "")
  .replace(/^\s*\d+[.)]\s+/, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const sameText = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The JSON object in a model reply, even inside a ```json fence or after a sentence. */
function jsonIn(raw) {
  const text = String(raw || "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** { deck, cards: [{ front, back }] } from a model reply; cards may be []. */
function parseCards(raw, { fallbackDeck = "" } = {}) {
  const data = jsonIn(raw) || {};
  const list = Array.isArray(data.cards) ? data.cards : Array.isArray(data) ? data : [];
  const cards = [];
  for (const item of list) {
    const front = tidy(item?.front ?? item?.question ?? item?.q, FRONT_CHARS);
    const back = tidy(item?.back ?? item?.answer ?? item?.a, BACK_CHARS);
    if (front.length < 3 || back.length < 1 || sameText(front, back)) continue;
    if (cards.some((c) => sameText(c.front, front))) continue;
    cards.push({ front, back });
    if (cards.length >= MAX_CARDS) break;
  }
  const deck = tidy(data.deck, 60) || tidy(fallbackDeck, 60);
  return { deck, cards };
}

/**
 * Flashcards for `text`. `callModel({ system, user, maxTokens, temperature })`
 * resolves to the model's reply. Resolves to { deck, cards }.
 */
async function generateFlashcards({ text, topic = "", callModel }) {
  const source = String(text || "").trim();
  if (source.length < 40) return { deck: "", cards: [] };
  const { system, user } = buildPrompt({ text: source, topic });
  const raw = await callModel({ system, user, maxTokens: 1400, temperature: 0.3 });
  return parseCards(raw, { fallbackDeck: topic });
}

module.exports = { generateFlashcards, parseCards, buildPrompt, MAX_CARDS };
