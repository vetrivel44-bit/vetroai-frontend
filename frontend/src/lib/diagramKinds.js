// What kind of Mermaid diagram a block is — used for the card title and to
// decide whether a flowchart gets the UML use case look.

export const RELATION_RE = /(«include»|«extend»|<<include>>|<<extend>>)/;

// A use case diagram has «include»/«extend» relations, or actors whose
// targets are mostly use-case pills. A 👤 alone isn't enough: models also put
// one on the user in architecture and flow diagrams, which then got the use
// case look and title.
export function isUseCaseDiagram(code) {
  if (!/^\s*(flowchart|graph)\b/m.test(code) || /^\s*(classDef|style|class)\s/m.test(code)) return false;
  if (RELATION_RE.test(code)) return true;
  if (!/\(\(\s*"?\s*👤/.test(code)) return false;
  const pills = (code.match(/[A-Za-z_][\w]*\s*\(\[/g) || []).length;
  const boxes = (code.match(/[A-Za-z_][\w]*\s*\[(?![[(])/g) || []).length;
  return pills >= 2 && pills >= boxes;
}

const DIAGRAM_NAMES = [
  [/^flowchart|^graph/i, "Flowchart"],
  [/^sequenceDiagram/i, "Sequence diagram"],
  [/^classDiagram/i, "Class diagram"],
  [/^stateDiagram/i, "State diagram"],
  [/^erDiagram/i, "ER diagram"],
  [/^gantt/i, "Gantt chart"],
  [/^mindmap/i, "Mind map"],
  [/^pie/i, "Pie chart"],
  [/^journey/i, "User journey"],
  [/^timeline/i, "Timeline"],
];
export const diagramName = (code) => {
  if (isUseCaseDiagram(code)) return "Use case diagram";
  // A flowchart grouped into several subgraphs is a system/architecture view.
  if (/^\s*(flowchart|graph)\b/im.test(code) && (code.match(/^\s*subgraph\b/gm) || []).length >= 2) return "Architecture diagram";
  const first = String(code).trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("%%")) || "";
  return DIAGRAM_NAMES.find(([rx]) => rx.test(first.trim()))?.[1] || "Diagram";
};
