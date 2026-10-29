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

test("a streaming flowchart is drawn from its finished lines", async () => {
  const { drawablePrefix } = await import("../src/lib/mermaidCode.js");
  assert.equal(drawablePrefix("flowchart TD\n  A[\"Door\"] --> B[\"Hal"), "", "nothing finished yet");
  assert.equal(drawablePrefix("flowchart TD\n  A[\"Door\"] --> B[\"Hall\"]\n  B --> C[\"Ki"), 'flowchart TD\n  A["Door"] --> B["Hall"]');
  assert.equal(drawablePrefix("flowchart LR\n  subgraph G[\"Up\"]\n    D[\"Bed\"]\n    E"), 'flowchart LR\n  subgraph G["Up"]\n    D["Bed"]\n  end', "open group closed");
  assert.equal(drawablePrefix("---\nlook: handDrawn\n---\nflowchart TD\n  A --> B\n"), "flowchart TD\n  A --> B");
  assert.equal(drawablePrefix("---\nlook: handDrawn\nflowchart TD\n"), "");
  assert.equal(drawablePrefix("sequenceDiagram\n  A->>B: hi\n"), "", "other kinds wait for the end");
});

test("repairs flowchart arrows Mermaid rejects, so the diagram draws", async () => {
  const { repairMermaid } = await import("../src/lib/mermaidCode.js");
  const code = [
    "flowchart TD",
    '  Volunteer["Volunteer"]',
    "  DB[(Database)]",
    "  Volunteer <--> WebApp",
    '  Volunteer --"1. Request Task Update">> WebApp',
    '  WebApp -- "2. Validate" ->> TaskService',
    "  TaskService --|3. Update|> DB",
    "  DB -->> TaskService",
    "  A -> B",
    "  B ->> C",
    "  C => D",
    "  D -.-> E",
    '  E -->|"ok"| F',
    '  F["a -> b"] --> G',
  ].join("\n");
  assert.equal(repairMermaid(code), [
    "flowchart TD",
    '  Volunteer["Volunteer"]',
    "  DB[(Database)]",
    "  Volunteer <--> WebApp",
    '  Volunteer -->|"1. Request Task Update"| WebApp',
    '  WebApp -->|"2. Validate"| TaskService',
    '  TaskService -->|"3. Update"| DB',
    "  DB --> TaskService",
    "  A --> B",
    "  B --> C",
    "  C ==> D",
    "  D -.-> E",
    '  E -->|"ok"| F',
    '  F["a -> b"] --> G',
  ].join("\n"));
});

test("leaves other kinds of diagram alone", async () => {
  const { repairMermaid } = await import("../src/lib/mermaidCode.js");
  const seq = "sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello";
  assert.equal(repairMermaid(seq), seq);
});
