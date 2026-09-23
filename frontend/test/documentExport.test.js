import test from "node:test";
import assert from "node:assert/strict";

import {
  requestedFileFormats,
  fileRequestInstruction,
  parseMarkdownBlocks,
  parseInline,
  spreadsheetTables,
  documentTitle,
  stripChatPreamble,
  toPdfText,
  isPdfSafe,
} from "../src/lib/documentExport.js";

test("file requests are recognised, ordinary questions are not", () => {
  assert.deepEqual(requestedFileFormats("give me the notes as a PDF"), ["pdf"]);
  assert.deepEqual(requestedFileFormats("Make a word document about photosynthesis"), ["docx"]);
  assert.deepEqual(requestedFileFormats("export this table to excel"), ["xlsx"]);
  assert.deepEqual(requestedFileFormats("put it in pdf and word"), ["pdf", "docx"]);
  assert.deepEqual(requestedFileFormats("how do I reduce pdf size in windows"), []);
  assert.deepEqual(requestedFileFormats("what is a word"), []);
});

test("the file instruction tells the model to write the document, not refuse", () => {
  const text = fileRequestInstruction(["pdf"]);
  assert.match(text, /PDF/);
  assert.match(text, /never say you cannot/i);
  assert.equal(fileRequestInstruction([]), "");
  assert.match(fileRequestInstruction(["xlsx"]), /Markdown tables/);
});

test("inline bold, italic, code and links become styled runs", () => {
  assert.deepEqual(parseInline("A **bold** and *it* with `x()` and [site](https://a.b)"), [
    { text: "A " },
    { text: "bold", bold: true },
    { text: " and " },
    { text: "it", italic: true },
    { text: " with " },
    { text: "x()", code: true },
    { text: " and " },
    { text: "site", link: "https://a.b" },
  ]);
});

test("a typical structured reply parses into headings, lists, tables and code", () => {
  const md = [
    "# Study Notes",
    "",
    "Intro paragraph with **key** term.",
    "",
    "## Points",
    "- first",
    "- second",
    "  - nested",
    "1. one",
    "2. two",
    "",
    "| Name | Score |",
    "|------|------:|",
    "| Ana  | 91    |",
    "| Bo   | 78    |",
    "",
    "> a quote",
    "",
    "```python",
    "print('hi')",
    "```",
    "---",
  ].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "heading", "list", "table", "quote", "code", "rule"]);
  assert.equal(blocks[0].level, 1);
  const list = blocks[3];
  assert.deepEqual(list.items.map((i) => [i.level, i.ordered]), [[0, false], [0, false], [1, false], [0, true], [0, true]]);
  assert.deepEqual(blocks[4].header, ["Name", "Score"]);
  assert.deepEqual(blocks[4].rows, [["Ana", "91"], ["Bo", "78"]]);
  assert.equal(blocks[6].language, "python");
  assert.equal(documentTitle(md), "Study Notes");
});

test("spreadsheet export uses real table columns, or one row per line without a table", () => {
  assert.deepEqual(spreadsheetTables("| A | B |\n|---|---|\n| **1** | 2 |"), [[["A", "B"], ["1", "2"]]]);
  assert.deepEqual(spreadsheetTables("# T\n- x\n- y"), [[["T"], ["x"], ["y"]]]);
});

test("a nested item is one level deeper however far it is indented", () => {
  const [list] = parseMarkdownBlocks("1. one\n2. two\n   - under two\n     - deeper\n3. three");
  assert.deepEqual(list.items.map((i) => i.level), [0, 0, 1, 2, 0]);
});

test("a short chat line before the document title is left out of the file", () => {
  assert.equal(stripChatPreamble("Here are your notes:\n\n# Title\nBody"), "# Title\nBody");
  assert.equal(stripChatPreamble("# Title\nBody"), "# Title\nBody");
  assert.equal(stripChatPreamble("No title here"), "No title here");
});

test("PDF text maps common symbols and flags scripts the built-in fonts can't draw", () => {
  assert.equal(toPdfText("CO₂ → sugar, x² ≥ 3 ◦ ok"), "CO2 -> sugar, x² >= 3 - ok");
  assert.equal(isPdfSafe(toPdfText("Café — “quoted” • done €5")), true);
  assert.equal(isPdfSafe("ஒளிச்சேர்க்கை"), false);
  assert.equal(isPdfSafe("नमस्ते"), false);
  assert.equal(isPdfSafe("Nice 😀"), false);
});
