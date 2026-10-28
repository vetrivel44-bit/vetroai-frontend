const test = require("node:test");
const assert = require("node:assert/strict");

const { GROUNDING_RULE, searchQueryFor, stripGalleryBlocks } = require("../src/services/searchGrounding");

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
