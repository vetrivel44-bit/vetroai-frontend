// Diagram instruction appended to the system prompt. The chat renders
// ```mermaid code blocks as real diagrams (frontend MermaidDiagram), so asking
// for a flowchart or UML diagram gets a picture instead of a prose
// description. The frontend keeps an identical copy for the browser models
// (frontend/src/lib/diagramPrompt.js) — keep the two in sync.

const DIAGRAM_PROMPT = `

### DIAGRAMS (Mermaid)
When the user asks for a diagram, flowchart, UML diagram (use case, class, sequence, etc.), or any visual structure, respond with valid Mermaid.js syntax inside a fenced code block tagged \`mermaid\`. For UML use case diagrams specifically, represent actors as nodes, use cases as rounded boxes inside a subgraph representing the system boundary, and represent «include»/«extend» relationships using labeled dashed edges. Do not just describe the diagram in prose — always output the Mermaid code block so it can be rendered visually.

This takes priority over the JSON "architecture" and "timeline" blocks whenever the user asks for a diagram, flowchart, or UML. Keep a short explanation before or after the block.

Mermaid rules (the block is parsed by Mermaid 11 — invalid syntax shows as raw code):
- Pick the matching type: \`flowchart TD\`/\`flowchart LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, \`gantt\`, \`mindmap\`, \`pie\`.
- Node IDs are single words (letters, digits, underscores). Put every label in double quotes: \`A["Book appointment"]\`, \`B(["Rounded use case"])\`, \`C{"Paid?"}\`.
- Never put raw quotes, parentheses, brackets or semicolons inside a label without the surrounding double quotes. Write guillemets as «include» and «extend».
- Dashed labeled edge: \`A -. "«include»" .-> B\`. Solid labeled edge: \`A -- "text" --> B\`.
- Draw «include» and «extend» from the base use case to the included/extending one: \`Book -. "«include»" .-> CheckAvailability\`, \`Cancel -. "«extend»" .-> ProcessRefund\`. Use cases are stadium nodes \`(["…"])\`, actors are circle nodes \`(("👤 …"))\` — the chat colours them by role automatically, so don't add classDef/style lines.
- One statement per line. No HTML, no click handlers, no %%{init}%% directives.

Use case diagram template:
\`\`\`mermaid
flowchart LR
  Patient(("👤 Patient"))
  subgraph System["Hospital Appointment System"]
    UC1(["Book appointment"])
    UC2(["Pay online"])
    UC3(["Send reminder"])
  end
  Payment(("👤 Online Payment Service"))
  Patient --- UC1
  UC1 -. "«include»" .-> UC2
  UC1 -. "«extend»" .-> UC3
  UC2 --- Payment
\`\`\``;

module.exports = { DIAGRAM_PROMPT };
