import test from "node:test";
import assert from "node:assert/strict";

import { deckSummary, deckToTsv, isCardLike, parseFlashcards, shuffled, MAX_CARDS } from "../src/lib/chatFlashcards.js";
import { detectVisual, mightBeVisual } from "../src/lib/visualDetect.js";

const DECK = JSON.stringify({
  title: "Organelles",
  cards: [
    { front: "Mitochondria", back: "Makes ATP", hint: "power station", example: "Muscle cells have many." },
    { question: "Nucleus?", answer: "Holds DNA" },
    { term: "Ribosome", definition: "Builds proteins" },
  ],
});

test("cards accept front/back, question/answer and term/definition", () => {
  const deck = parseFlashcards(DECK);
  assert.equal(deck.title, "Organelles");
  assert.deepEqual(deck.cards.map((c) => [c.front, c.back]), [["Mitochondria", "Makes ATP"], ["Nucleus?", "Holds DNA"], ["Ribosome", "Builds proteins"]]);
  assert.equal(deck.cards[0].hint, "power station");
  assert.equal(deck.cards[0].example, "Muscle cells have many.");
});

test("a bare array is a deck with a default title, capped at the limit", () => {
  const many = Array.from({ length: MAX_CARDS + 5 }, (_, i) => ({ front: `F${i}`, back: `B${i}` }));
  const deck = parseFlashcards(JSON.stringify(many));
  assert.equal(deck.title, "Flashcards");
  assert.equal(deck.cards.length, MAX_CARDS);
});

test("bad decks are rejected so the chat shows the code instead", () => {
  assert.throws(() => parseFlashcards('{"cards": []}'), /no cards/);
  assert.throws(() => parseFlashcards('{"cards": [{"front": "x"}]}'), /no back/);
  assert.throws(() => parseFlashcards('{"cards": [{"back": "x"}]}'), /no front/);
});

test("a deck fenced as json or cards is still drawn as flashcards, a quiz stays a quiz", () => {
  assert.equal(detectVisual("json", DECK)?.kind, "flashcards");
  assert.equal(detectVisual("cards", DECK)?.kind, "flashcards");
  assert.ok(mightBeVisual("", DECK));
  const quiz = JSON.stringify({ questions: [{ question: "x", options: ["a", "b"], answer: "a" }] });
  assert.equal(detectVisual("json", quiz)?.kind, "quiz");
  assert.equal(isCardLike({ question: "x", options: ["a"], answer: "a" }), false);
});

test("shuffle keeps every card, the export is Anki-ready and the summary adds up", () => {
  const ids = [0, 1, 2, 3, 4];
  assert.deepEqual([...shuffled(ids, () => 0.3)].sort(), ids);
  assert.equal(deckToTsv({ cards: [{ front: "A\tb", back: "line\none" }] }), "A b\tline one\n");
  assert.deepEqual(deckSummary(4, 3), { total: 4, known: 3, learning: 1, percent: 75, verdict: "Nearly there. Review the few you missed." });
});
