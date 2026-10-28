const test = require("node:test");
const assert = require("node:assert/strict");

const { needsLiveInfo } = require("../src/services/liveInfoIntent");
const orchestrator = require("../src/services/AIOrchestrator");

const LIVE = [
  "is TTV Vasan in bigg boss season 10",
  "Is TTV Vasan in Bigg Boss Season 10?",
  "bigg boss tamil season 10 contestants",
  "who hosts bigg boss tamil",
  "who got evicted this week",
  "Did India win the match yesterday",
  "is Vijay still the president of TVK",
  "who is the chief minister of tamil nadu",
  "leo box office collection",
  "when is the next ipl match",
  "upcoming movies on netflix",
  "petrol price of chennai",
  "what happened in 2027",
];

const NOT_LIVE = [
  "hi",
  "what is DBMS",
  "difference between stack and queue",
  "write a poem about rain",
  "explain photosynthesis",
  "fix this python function",
  "plan a birthday party for my son",
];

test("questions whose answer may have changed are sent to web search", () => {
  for (const q of LIVE) assert.equal(needsLiveInfo(q), true, q);
});

test("timeless questions are answered without a search", () => {
  for (const q of NOT_LIVE) assert.equal(needsLiveInfo(q), false, q);
});

test("the orchestrator uses the shared patterns", () => {
  assert.equal(orchestrator.needsWebSearch("is TTV Vasan in bigg boss season 10"), true);
  assert.equal(orchestrator.needsWebSearch("what is DBMS"), false);
});
