const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCards, generateFlashcards, buildPrompt } = require("../src/services/flashcardService");

test("cards come out of the model's JSON, even inside a fence or after a sentence", () => {
  const raw = 'Here you go:\n```json\n{"deck":"Photosynthesis","cards":[{"front":"Where does photosynthesis happen?","back":"In the chloroplasts of plant cells."},{"front":"What gas do plants take in?","back":"Carbon dioxide."}]}\n```';
  assert.deepEqual(parseCards(raw), {
    deck: "Photosynthesis",
    cards: [
      { front: "Where does photosynthesis happen?", back: "In the chloroplasts of plant cells." },
      { front: "What gas do plants take in?", back: "Carbon dioxide." },
    ],
  });
});

test("empty, repeated and markdown-dressed cards are tidied or dropped", () => {
  const raw = JSON.stringify({ cards: [
    { front: "**Q: What is RAM?**", back: "A: Short-term memory a computer uses while running programs." },
    { front: "what is ram", back: "Same question again." },
    { front: "Empty back", back: "" },
    { front: "Same", back: "same" },
    { question: "1. Who wrote it?", answer: "Nobody." },
  ] });
  const { cards, deck } = parseCards(raw, { fallbackDeck: "Computers" });
  assert.deepEqual(cards.map((c) => c.front), ["What is RAM?", "Who wrote it?"]);
  assert.equal(cards[0].back, "Short-term memory a computer uses while running programs.");
  assert.equal(deck, "Computers", "the question names the deck when the model doesn't");
  assert.deepEqual(parseCards("not json at all"), { deck: "", cards: [] });
});

test("the prompt asks for one idea per card, in the writing's language", () => {
  const { system, user } = buildPrompt({ text: "Some answer", topic: "What is photosynthesis?" });
  assert.match(system, /4 to 10 cards/);
  assert.match(system, /same language as the writing/);
  assert.match(user, /The question this answered: What is photosynthesis\?/);
});

test("a very short answer makes no cards and asks no model", async () => {
  let asked = false;
  const result = await generateFlashcards({ text: "Yes.", callModel: async () => { asked = true; return ""; } });
  assert.deepEqual(result, { deck: "", cards: [] });
  assert.equal(asked, false);
});
