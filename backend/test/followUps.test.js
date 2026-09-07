const test = require("node:test");
const assert = require("node:assert/strict");

const followUpService = require("../src/services/followUpService");

const ANSWER = `Postgres chose a sequential scan because the planner estimated the filter
would match 40% of the 2.1M rows in orders, and above roughly 5-10% a seq scan beats
random index lookups. Running ANALYZE fixed a stale n_distinct on status. With accurate
stats it switched to the partial index on (status) WHERE status = 'pending', and the query
dropped from 4.2s to 90ms.`;

test("generic question shapes are recognised", () => {
  const generic = [
    "What are the benefits of indexing?",
    "What are the main challenges of this approach?",
    "How does Postgres work?",
    "Can you tell me more about this?",
    "Tell me more",
    "Why is this important?",
  ];
  for (const q of generic) {
    assert.equal(followUpService.isGeneric(q), true, `should flag: ${q}`);
  }
});

test("specific questions are not mistaken for generic ones", () => {
  const specific = [
    "Why does the planner pick a seq scan above 10% selectivity?",
    "How much did ANALYZE change the n_distinct estimate?",
    "Would a BRIN index beat the partial index on status?",
    "What happens to the 90ms figure as orders grows past 10M?",
    "How does pgbouncer change this at 500 connections?",
  ];
  for (const q of specific) {
    assert.equal(followUpService.isGeneric(q), false, `should keep: ${q}`);
  }
});

test("parses a plain JSON array", () => {
  const items = followUpService.parseSuggestions('["One question?", "Two question?"]');
  assert.deepEqual(items, ["One question?", "Two question?"]);
});

test("parses a JSON array wrapped in a code fence or prose", () => {
  const raw = 'Here you go:\n```json\n["Why does it scan?", "What breaks at 10M rows?"]\n```';
  assert.deepEqual(followUpService.parseSuggestions(raw), ["Why does it scan?", "What breaks at 10M rows?"]);
});

test("falls back to line parsing when the model ignores JSON", () => {
  const raw = "1. Why does the planner scan?\n2. What breaks at 10M rows?\n- How stale were the stats?";
  const items = followUpService.parseSuggestions(raw);
  assert.deepEqual(items, ["Why does the planner scan?", "What breaks at 10M rows?", "How stale were the stats?"]);
});

test("cleanup drops generic suggestions and keeps specific ones", () => {
  const cleaned = followUpService.cleanSuggestions([
    "What are the benefits of indexing?",              // generic — dropped
    "Why does the planner pick a seq scan here?",      // kept
    "How does Postgres work?",                         // generic — dropped
    "Would a BRIN index beat the partial index?",      // kept
  ]);
  assert.deepEqual(cleaned, [
    "Why does the planner pick a seq scan here?",
    "Would a BRIN index beat the partial index?",
  ]);
});

test("cleanup removes duplicates that differ only in wording noise", () => {
  const cleaned = followUpService.cleanSuggestions([
    "Why does the planner choose a seq scan?",
    "why does THE planner choose a seq scan???",
    "Why does a planner choose the seq scan?",
  ]);
  assert.equal(cleaned.length, 1, "near-identical questions collapse to one");
});

test("cleanup strips numbering, bullets and quotes", () => {
  const cleaned = followUpService.cleanSuggestions([
    '1. "Why does the planner pick a seq scan here?"',
    "- Would a BRIN index beat the partial one?",
  ]);
  assert.deepEqual(cleaned, [
    "Why does the planner pick a seq scan here?",
    "Would a BRIN index beat the partial one?",
  ]);
});

test("cleanup adds a missing question mark but rejects prose", () => {
  const cleaned = followUpService.cleanSuggestions([
    "How stale were the statistics",
    "Here are some questions you might ask next.",
  ]);
  assert.deepEqual(cleaned, ["How stale were the statistics?"]);
});

test("cleanup caps the list at four", () => {
  const cleaned = followUpService.cleanSuggestions([
    "Why does the planner scan sequentially?",
    "How stale was n_distinct on status?",
    "Would BRIN beat the partial index?",
    "What happens past 10M rows?",
    "How does this interact with autovacuum?",
  ]);
  assert.equal(cleaned.length, 4);
});

test("the prompt carries the whole answer and the conversation", async () => {
  const { system, user } = followUpService.buildPrompt({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [
      { role: "user", content: "Why is my orders query slow?" },
      { role: "assistant", content: ANSWER },
    ],
  });
  assert.match(system, /Perplexity/i, "states the target style");
  assert.match(system, /Anchor every question/i, "demands specificity");
  assert.match(system, /What are the benefits of X/i, "shows what to avoid");
  assert.ok(user.includes("90ms"), "the full answer reaches the model, not a 600-char prefix");
  assert.ok(user.includes("Conversation so far"), "recent turns are included");
});

test("end to end: a templated model reply yields nothing rather than filler", async () => {
  const suggestions = await followUpService.generateFollowUps({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [],
    callModel: async () => JSON.stringify([
      "What are the benefits of indexes?",
      "How does Postgres work?",
      "What are the challenges of this approach?",
      "Can you tell me more?",
    ]),
  });
  assert.deepEqual(suggestions, [], "all four were generic, so none are shown");
});

test("end to end: specific model output survives intact", async () => {
  const suggestions = await followUpService.generateFollowUps({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [],
    callModel: async () => JSON.stringify([
      "Why does the planner switch above 10% selectivity?",
      "How stale was n_distinct before ANALYZE ran?",
      "Would a BRIN index beat the partial one here?",
      "Does the 90ms hold as orders grows past 10M rows?",
    ]),
  });
  assert.equal(suggestions.length, 4);
  assert.ok(suggestions.every((q) => q.endsWith("?")));
  assert.ok(suggestions.some((q) => /n_distinct|BRIN|90ms|10%/.test(q)), "questions cite the answer's specifics");
});
