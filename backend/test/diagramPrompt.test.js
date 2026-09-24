const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const { DIAGRAM_PROMPT } = require("../src/services/diagramPrompt");

test("normal chat asks for Mermaid diagrams", async () => {
  const sys = await orchestrator.buildSystemPrompt("normal", { userQuery: "draw a flowchart" });
  assert.ok(sys.includes("### DIAGRAMS (Mermaid)"));
  assert.ok(sys.includes("fenced code block tagged `mermaid`"));
  assert.ok(sys.includes("«include»/«extend»"));
});

test("design and computer-use prompts stay free of the diagram rule", async () => {
  for (const mode of ["design", "computer_use"]) {
    const sys = await orchestrator.buildSystemPrompt(mode, { userQuery: "x" });
    assert.ok(!sys.includes("### DIAGRAMS (Mermaid)"), mode);
  }
});

test("the browser-model copy of the prompt matches the backend's", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/lib/diagramPrompt.js"), "utf8");
  const literal = src.slice(src.indexOf("= ") + 2, src.lastIndexOf(";"));
  assert.equal(JSON.parse(literal), DIAGRAM_PROMPT);
});
