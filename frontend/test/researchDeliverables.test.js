import test from "node:test";
import assert from "node:assert/strict";

import { isResearchFileRequest, sheetMarkdown, slidesCode, topicTitle, wantedFiles } from "../src/lib/researchDeliverables.js";

test("research asks that want files are recognised", () => {
  assert.ok(isResearchFileRequest("Research the best electric scooters in India and make a slide deck"));
  assert.ok(isResearchFileRequest("Compare the top 5 CRMs for small businesses in a spreadsheet"));
  assert.ok(isResearchFileRequest("Do a market analysis of EV charging in Tamil Nadu as a PDF report"));
  assert.ok(!isResearchFileRequest("Build a website for my bakery"));
  assert.ok(!isResearchFileRequest("What is the capital of France?"));
  assert.deepEqual(wantedFiles("make a deck and an excel sheet"), { slides: true, sheet: true, doc: true });
  assert.deepEqual(wantedFiles("write a report"), { slides: false, sheet: false, doc: true });
});

test("the deck and the tables are taken from the model's reply", () => {
  assert.equal(slidesCode('Here it is:\n```slides\n{"title":"X","slides":[]}\n```\nWant changes?'), '{"title":"X","slides":[]}');
  assert.equal(slidesCode("no deck"), null);
  const md = sheetMarkdown("Sure!\n### Comparison\n| Name | Price |\n|---|---|\n| Ather | ₹1.4L |\n");
  assert.match(md, /^### Comparison/);
  assert.equal(sheetMarkdown("no tables here"), "");
  assert.match(sheetMarkdown("```markdown\n| A | B |\n|---|---|\n| 1 | 2 |\n```"), /^\| A \| B \|/);
});

test("a short title from the request", () => {
  assert.equal(topicTitle("Research the best electric scooters in India under ₹1.5 lakh and make a slide deck and a spreadsheet"), "Best electric scooters in India under ₹1.5 lakh");
});
