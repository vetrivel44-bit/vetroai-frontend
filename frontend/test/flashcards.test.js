import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY, MINUTE, addCards, decks, dueCards, formatWait, makeCard, mergeCards, nextDue, previewWaits, requestFlashcards, review,
} from "../src/lib/flashcards.js";

const T0 = Date.UTC(2026, 10, 17, 9, 0, 0);

test("a card you keep remembering comes back after 1 day, 3 days, a week, then further apart", () => {
  let card = makeCard({ front: "Capital of Tamil Nadu?", back: "Chennai", deck: "India" }, T0);
  assert.equal(card.due, T0, "a new card is due at once");
  let now = T0;
  const waits = [];
  for (let i = 0; i < 5; i++) {
    card = review(card, "good", now);
    waits.push(Math.round((card.due - now) / DAY));
    now = card.due;
  }
  assert.deepEqual(waits.slice(0, 3), [1, 3, 7]);
  assert.ok(waits[3] > 14 && waits[4] > waits[3] * 2, `then further apart: ${waits}`);
});

test("forgetting brings a card back in 10 minutes and starts it over", () => {
  let card = makeCard({ front: "Q", back: "A" }, T0);
  card = review(card, "good", T0);
  card = review(card, "good", card.due);
  const forgotten = review(card, "again", card.due);
  assert.equal(forgotten.due - card.due, 10 * MINUTE);
  assert.equal(forgotten.reps, 0);
  assert.equal(forgotten.lapses, 1);
  assert.ok(forgotten.ease < card.ease, "it will come back sooner from now on");
  const relearnt = review(forgotten, "good", forgotten.due);
  assert.equal(Math.round((relearnt.due - forgotten.due) / DAY), 1);
});

test("each answer button shows a different wait, Easy always the furthest", () => {
  const fresh = makeCard({ front: "Q", back: "A" }, T0);
  assert.deepEqual(previewWaits(fresh, T0), { again: "10 min", hard: "6 hours", good: "1 day", easy: "3 days" });
  let card = review(fresh, "good", T0);
  card = review(card, "good", card.due);
  assert.deepEqual(previewWaits(card, card.due), { again: "10 min", hard: "4 days", good: "1 week", easy: "10 days" });
  assert.throws(() => review(card, "maybe", T0));
});

test("waits read naturally", () => {
  assert.equal(formatWait(10 * MINUTE), "10 min");
  assert.equal(formatWait(6 * 60 * MINUTE), "6 hours");
  assert.equal(formatWait(DAY), "1 day");
  assert.equal(formatWait(7 * DAY), "1 week");
  assert.equal(formatWait(10 * DAY), "10 days");
  assert.equal(formatWait(21 * DAY), "3 weeks");
  assert.equal(formatWait(70 * DAY), "2 months");
});

test("due cards, the next one coming, and decks", () => {
  const a = makeCard({ front: "A?", back: "a", deck: "Maths" }, T0);
  const b = review(makeCard({ front: "B?", back: "b", deck: "Maths" }, T0), "good", T0);
  const c = makeCard({ front: "C?", back: "c", deck: "History" }, T0 + 1);
  const cards = [a, b, c];
  assert.deepEqual(dueCards(cards, T0 + 5).map((x) => x.front), ["A?", "C?"]);
  assert.equal(nextDue(cards, T0 + 5), b.due);
  const list = decks(cards, T0 + 5);
  assert.deepEqual(list.find((d) => d.name === "Maths"), { name: "Maths", total: 2, due: 1, learned: 0 });
  assert.equal(nextDue([], T0), null);
});

test("new cards join a deck, without repeating a question already there", () => {
  const first = addCards([], [{ front: "What is RAM?", back: "Working memory." }, { front: "", back: "x" }], { deck: "Computers" }, T0);
  assert.equal(first.added.length, 1);
  const again = addCards(first.cards, [{ front: "what is RAM", back: "Same." }, { front: "What is ROM?", back: "Read-only memory." }], { deck: "Computers" }, T0);
  assert.deepEqual(again.added.map((c) => c.front), ["What is ROM?"]);
  assert.equal(again.cards.length, 2);
});

test("across devices, a card keeps its latest review, and deleted cards stay deleted", () => {
  const card = makeCard({ front: "Q", back: "A" }, T0);
  const reviewedOnPhone = review(card, "good", T0 + DAY);
  const gone = makeCard({ front: "Old", back: "x" }, T0);
  const merged = mergeCards([card, gone], [reviewedOnPhone], [gone.id]);
  assert.deepEqual(merged, [reviewedOnPhone]);
});

test("the server's flashcards arrive, and its errors are shown as they are", async () => {
  let sent = null;
  const ok = await requestFlashcards("/api", { text: "Long answer", topic: "Q" }, {
    fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ data: { deck: "Topic", cards: [{ front: "F", back: "B" }] } }) }; },
  });
  assert.equal(sent.url, "/api/flashcards");
  assert.deepEqual(sent.body, { text: "Long answer", topic: "Q" });
  assert.deepEqual(ok, { deck: "Topic", cards: [{ front: "F", back: "B" }] });
  await assert.rejects(
    requestFlashcards("/api", { text: "x" }, { fetchImpl: async () => ({ ok: false, json: async () => ({ message: "Couldn't find anything in this answer to make flashcards from." }) }) }),
    /Couldn't find anything/,
  );
  await assert.rejects(requestFlashcards("/api", { text: "x" }, { fetchImpl: async () => { throw new TypeError("offline"); } }), /Check your connection/);
});
