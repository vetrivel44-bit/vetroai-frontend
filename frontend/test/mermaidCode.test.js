import test from "node:test";
import assert from "node:assert/strict";

import { alignSubgraphs, stripModelStyling } from "../src/lib/mermaidCode.js";

test("drops the model's own colours so the chat's palette applies", () => {
  const code = [
    "%%{init: {'theme':'forest'}}%%",
    "flowchart TD",
    '  A["Variables"]:::yellow --> B["Loops"]',
    "  style A fill:#ffeb3b,stroke:#333",
    "  classDef yellow fill:#ff0",
    "  class B yellow",
    "  linkStyle 0 stroke:#f0f",
  ].join("\n");
  assert.equal(stripModelStyling(code), 'flowchart TD\n  A["Variables"] --> B["Loops"]');
});

test("leaves labels that merely mention the words alone", () => {
  const code = 'flowchart LR\n  A["style guide"] --> B["class notes"]\n  B --> C["Ratio 3:::1"]';
  assert.equal(stripModelStyling(code), 'flowchart LR\n  A["style guide"] --> B["class notes"]\n  B --> C["Ratio 3:::1"]', "not a class name");
});

test("subgraphs follow the chart's direction unless they set one", () => {
  const td = 'flowchart TD\n  subgraph PB["Basics"]\n    A --> B\n  end';
  assert.equal(alignSubgraphs(td), 'flowchart TD\n  subgraph PB["Basics"]\n    direction TB\n    A --> B\n  end');
  const own = "flowchart LR\n  subgraph S\n  direction TB\n  A --> B\n  end";
  assert.equal(alignSubgraphs(own), own);
  assert.equal(alignSubgraphs("sequenceDiagram\n  A->>B: hi"), "sequenceDiagram\n  A->>B: hi");
});

test("spots Mermaid's own hand-drawn setting", async () => {
  const { wantsHandDrawn } = await import("../src/lib/mermaidCode.js");
  assert.equal(wantsHandDrawn("---\nconfig:\n  look: handDrawn\n---\nflowchart TD\n  A --> B"), true);
  assert.equal(wantsHandDrawn("flowchart TD\n  A[\"look: handDrawn\"] --> B"), false);
});
