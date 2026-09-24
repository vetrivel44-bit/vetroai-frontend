const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const { VISUALS_PROMPT } = require("../src/services/visualsPrompt");

test("normal chat asks for inline visuals", async () => {
  const sys = await orchestrator.buildSystemPrompt("normal", { userQuery: "draw a flowchart" });
  assert.ok(sys.includes("### INLINE VISUALS"));
  for (const tag of ["```mermaid", "```chartjs", "```html widget", "```json map", "erDiagram"]) assert.ok(sys.includes(tag), tag);
  assert.ok(sys.includes("Never mix multiple visual types in one code block."));
});

test("design and computer-use prompts stay free of the visuals rule", async () => {
  for (const mode of ["design", "computer_use"]) {
    const sys = await orchestrator.buildSystemPrompt(mode, { userQuery: "x" });
    assert.ok(!sys.includes("### INLINE VISUALS"), mode);
  }
});

test("the browser-model copy of the prompt matches the backend's", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/visualsPrompt.js"), "utf8");
  const literal = src.slice(src.indexOf("= ") + 2, src.lastIndexOf(";"));
  assert.equal(JSON.parse(literal), VISUALS_PROMPT);
});
