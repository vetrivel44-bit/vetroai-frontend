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
  "tell about gemini argon",
  "Tell me about Gemini Argon",
  "what is gpt-5.6 sol",
  "have you heard of nano banana",
  "do you know about the pixel 11",
  "any info on the rtx 6090",
  "What share of India's electricity comes from coal, solar, wind, hydro and nuclear? Show it as a chart",
  "Rank the 10 most populous states of India in a chart",
  "literacy rate of kerala",
];

const NOT_LIVE = [
  "hi",
  "what is DBMS",
  "difference between stack and queue",
  "write a poem about rain",
  "explain photosynthesis",
  "fix this python function",
  "plan a birthday party for my son",
  "draw pixel art of a cat",
  "write a story about a dragon",
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

// Questions with no "2026", "latest" or "news" in them, which were answered
// from the models' out-of-date memory before the rule was turned around.
const NO_TIME_WORD_BUT_CURRENT = [
  "best phones under 30000",
  "tamil nadu cm",
  "zephyr x9 review",
  "kerala tourism package cost",
  "who runs twitter",
  "how to apply for passport in india",
  "make a list of the best phones",
  "top engineering colleges in tamil nadu",
  "what is zephyr x9",
  "anna university exam date",
  "TVK party",
];
const STILL_TIMELESS = [
  "review my essay",
  "how does photosynthesis work",
  "why is the sky blue",
  "2+2*3",
  "translate hello to tamil",
  "thank you so much",
  "Kubernetes",
  "what is machine learning",
  "solve x^2 - 4 = 0",
  "good morning",
  "tell me a joke",
  "summarize this document",
];

test("questions without a time word are searched unless they're clearly timeless", () => {
  for (const q of NO_TIME_WORD_BUT_CURRENT) assert.equal(needsLiveInfo(q), true, q);
  for (const q of STILL_TIMELESS) assert.equal(needsLiveInfo(q), false, q);
});

test("in coding, creative and similar modes only clearly-current questions search", () => {
  assert.equal(needsLiveInfo("best laptop for coding", { mode: "debugger" }), false);
  assert.equal(needsLiveInfo("latest react version", { mode: "debugger" }), true);
  assert.equal(needsLiveInfo("best laptop for coding", { mode: "normal" }), true);
  assert.equal(orchestrator.needsWebSearch("tamil nadu cm", "normal"), true);
  assert.equal(orchestrator.needsWebSearch("tamil nadu cm", "summarize"), false);
});
