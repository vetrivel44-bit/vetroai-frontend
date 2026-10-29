import test from "node:test";
import assert from "node:assert/strict";

import { parseMarkdownBlocks } from "../src/lib/documentExport.js";
import { bookPlan } from "../src/lib/bookPdf.js";
import { courseMarkdown } from "../src/lib/course.js";

const tick = "`";
const fence = "```";

test("code under a numbered exercise is a code block, not text glued to the item", () => {
  const md = [
    "1. Compute a weekly wage:",
    `   ${fence}javascript`,
    "   const wage = 18 * 37.5;",
    `   console.log(${tick}Weekly: \${wage}${tick});`,
    `   ${fence}`,
    "2. Explain the event loop.",
  ].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ["list", "code", "list"]);
  // The list's indent is gone, and the template literal keeps its backticks.
  assert.equal(blocks[1].language, "javascript");
  assert.equal(blocks[1].text, `const wage = 18 * 37.5;\nconsole.log(${tick}Weekly: \${wage}${tick});`);
  // "2." after the code block is still 2, not a new list's 1.
  assert.equal(blocks[2].items[0].number, 2);
});

test("a fence stuck to a sentence becomes a code block in the course", () => {
  const md = courseMarkdown({ title: "T", chapters: [{ title: "A", markdown: `## Chapter 1: A\n\nHere it is:${fence}js\nlet x = 1;\n${fence}` }] });
  const code = parseMarkdownBlocks(md).find((b) => b.type === "code");
  assert.equal(code?.text, "let x = 1;");
});

test("the book: cover lines, chapters, and its own contents instead of the Markdown list", () => {
  const md = courseMarkdown({
    title: "Node.js from Zero",
    audience: "For complete beginners",
    chapters: [
      { title: "Setup", markdown: "## Chapter 1: Setup\n\nText." },
      { title: "Modules", markdown: "## Chapter 2: Modules\n\nText." },
    ],
  });
  const plan = bookPlan(md);
  assert.equal(plan.title, "Node.js from Zero");
  assert.ok(plan.subtitle.some((s) => /For complete beginners/.test(s)));
  assert.deepEqual(plan.chapters.map((c) => [c.number, c.title]), [[1, "Setup"], [2, "Modules"]]);
  assert.ok(!plan.body.some((b) => b.type === "heading" && /contents/i.test(b.runs.map((r) => r.text).join(""))));
  assert.ok(!plan.body.some((b) => b.type === "list"), "the Markdown contents list is dropped");
});
