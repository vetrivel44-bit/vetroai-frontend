import test from "node:test";
import assert from "node:assert/strict";

import { diagramName, isUseCaseDiagram } from "../src/lib/diagramKinds.js";

test("an architecture flowchart with a 👤 user is not called a use case diagram", () => {
  const code = `flowchart LR
  U(("👤 Shopper"))
  subgraph UI["Web / Mobile UI"]
    W["Website / App"]
  end
  subgraph BS["Backend Services"]
    P["Payment Service"]
    C["Catalog Service"]
  end
  U --> W --> P & C`;
  assert.equal(isUseCaseDiagram(code), false);
  assert.equal(diagramName(code), "Architecture diagram");
});

test("real use case diagrams are still recognised", () => {
  const withRelations = `flowchart LR
  A(("👤 Customer")) --- B(["Place order"])
  B -.->|«include»| C(["Pay"])`;
  assert.equal(isUseCaseDiagram(withRelations), true);
  assert.equal(diagramName(withRelations), "Use case diagram");

  const actorsAndPills = `flowchart LR
  A(("👤 Student")) --- B(["Enroll in course"])
  A --- C(["Submit assignment"])
  A --- D(["View grades"])`;
  assert.equal(isUseCaseDiagram(actorsAndPills), true);
});

test("other diagram types keep their names", () => {
  assert.equal(diagramName("flowchart TD\n  A --> B"), "Flowchart");
  assert.equal(diagramName("sequenceDiagram\n  A->>B: hi"), "Sequence diagram");
  assert.equal(diagramName("erDiagram\n  A ||--o{ B : has"), "ER diagram");
  assert.equal(diagramName("%% comment\nclassDiagram\n  class A"), "Class diagram");
});
