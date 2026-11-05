const test = require("node:test");
const assert = require("node:assert/strict");

const { GROUNDING_RULE, leansOnContext, searchQueryFor, stripGalleryBlocks } = require("../src/services/searchGrounding");

const history = [
  { role: "user", content: "who is the cm of tn" },
  { role: "assistant", content: "C. Joseph Vijay, since 10 May 2026 [1]." },
];

test("a follow-up is searched with the question it follows", () => {
  assert.equal(searchQueryFor("then cm of tn in 2025 ?", history), "who is the cm of tn — then cm of tn in 2025 ?");
  assert.equal(searchQueryFor("what about his party", history), "who is the cm of tn — what about his party");
  assert.equal(searchQueryFor("in 2024?", history), "who is the cm of tn — in 2024?");
});

test("a question that stands on its own is searched as it is", () => {
  assert.equal(searchQueryFor("tell about gemini argon", history), "tell about gemini argon");
  assert.equal(searchQueryFor("then cm of tn in 2025 ?", []), "then cm of tn in 2025 ?");
  const long = "and what were the main achievements of the previous government in health and education";
  assert.equal(searchQueryFor(long, history), long);
});

test("picture galleries are removed from earlier replies", () => {
  const reply = 'Vijay took office [1].\n\n```json\n{"type": "visual_gallery", "query": "cm", "images": [{"url": "https://x.com/a.jpg"}]}\n```';
  assert.equal(stripGalleryBlocks(reply), "Vijay took office [1].");
  const chart = '```json\n{"type": "chart", "data": []}\n```';
  assert.equal(stripGalleryBlocks(chart), chart);
});

test("the model answers the uncovered part from its own knowledge", () => {
  assert.match(GROUNDING_RULE, /own knowledge/);
  assert.match(GROUNDING_RULE, /never reply only that the sources don't say/);
  assert.match(GROUNDING_RULE, /visual_gallery/);
});

test("well-known reference data is charted, not refused", () => {
  // "Show Tamil Nadu's monthly temperature and rainfall" was refused as
  // "inventing numbers" when the search found no climate data.
  const { VISUALS_PROMPT } = require("../src/services/visualsPrompt");
  assert.match(GROUNDING_RULE, /climate averages/);
  assert.match(VISUALS_PROMPT, /climate averages \(monthly temperature, rainfall\)/);
  assert.match(VISUALS_PROMPT, /even when no search results cover it/);
});

// The conversation in the bug report: the third question was searched on its
// own and answered with reviews of another film.
const ramayana = [
  { role: "user", content: "Ramayana collection till now" },
  { role: "assistant", content: "Ramayana has grossed about ₹200 crore worldwide [1]." },
  { role: "user", content: "Total" },
  { role: "assistant", content: "Total worldwide gross (till 5 Nov 2026): ≈ ₹200 crore." },
];

test("a follow-up after another follow-up is searched with the question that named the topic", () => {
  assert.equal(searchQueryFor("Is the reviews good for this movie", ramayana), "Ramayana collection till now — Is the reviews good for this movie");
  assert.equal(searchQueryFor("Total", ramayana.slice(0, 2)), "Ramayana collection till now — Total");
  assert.equal(searchQueryFor("how much does it cost", history), "who is the cm of tn — how much does it cost");
});

test("a new subject is not tied to the last one", () => {
  assert.equal(searchQueryFor("weather in chennai today", ramayana), "weather in chennai today");
  assert.equal(searchQueryFor("iphone 17 price in india", ramayana), "iphone 17 price in india");
  assert.equal(leansOnContext("2026"), false, "a lone number is not a follow-up");
});
