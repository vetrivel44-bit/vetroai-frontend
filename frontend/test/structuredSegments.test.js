import test from "node:test";
import assert from "node:assert/strict";

import { splitVisualBlocks, hasVisualBlocks, visualsToMarkdown } from "../src/lib/structuredSegments.js";

test("visual JSON blocks are pulled out in place, fenced or bare", () => {
  const reply = [
    "## Day-by-Day Timeline (visual)",
    "```json",
    '{"type": "timeline", "title": "5-Day Trip", "steps": [{"title": "Day 1", "description": "Arrive"},]}',
    "```",
    "## Budget",
    '{"type": "chart", "chartType": "pie", "title": "Budget", "data": [{"name": "Hotel", "value": 5000}]}',
    "Enjoy the trip!",
  ].join("\n");
  const segments = splitVisualBlocks(reply);
  assert.deepEqual(segments.map((s) => s.kind), ["text", "visual", "text", "visual", "text"]);
  assert.equal(segments[1].data.type, "timeline");
  assert.equal(segments[1].data.steps[0].title, "Day 1");
  assert.equal(segments[3].data.chartType, "pie");
  assert.match(segments[4].text, /Enjoy the trip/);
});

test("ordinary code and unknown or half-streamed JSON stay as text", () => {
  const code = "```js\nconst a = {\"type\": \"timeline\"};\n```";
  assert.equal(hasVisualBlocks(code), false);
  assert.equal(hasVisualBlocks('{"type": "user", "name": "x"}'), false);
  assert.equal(hasVisualBlocks('{"type": "timeline", "steps": [{"title": "Da'), false);
  assert.deepEqual(splitVisualBlocks("plain text"), [{ kind: "text", text: "plain text" }]);
});

test("downloads get visual blocks as readable lists and tables", () => {
  const md = visualsToMarkdown('Plan:\n{"type": "timeline", "title": "Trip", "steps": [{"title": "Day 1", "description": "Arrive"}]}\n{"type": "chart", "data": [{"name": "Hotel", "value": 5000}]}');
  assert.match(md, /\*\*Trip\*\*\n\n1\. \*\*Day 1\*\* — Arrive/);
  assert.match(md, /\| name \| value \|\n\|---\|---\|\n\| Hotel \| 5000 \|/);
  assert.doesNotMatch(md, /"type"/);
});
