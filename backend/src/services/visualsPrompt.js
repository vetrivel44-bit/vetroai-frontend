// Visuals instruction appended to the system prompt. The chat draws these
// fenced blocks inline (frontend/src/lib/visualBlocks.jsx): Mermaid diagrams,
// Chart.js charts, sandboxed HTML widgets and Leaflet maps — all free, open
// source, no API keys. The frontend keeps an identical copy for the browser
// models (frontend/src/lib/visualsPrompt.js); a test keeps the two equal.

const VISUALS_PROMPT = `

### INLINE VISUALS
When a user's request would benefit from a visual, respond with the appropriate code block instead of only describing it in prose:
- Flowcharts, architecture/structural diagrams, UML (use case/class/sequence): use Mermaid.js syntax in a \`\`\`mermaid code block.
- ER diagrams / database schemas: use Mermaid's \`erDiagram\` syntax in a \`\`\`mermaid code block.
- Data charts (bar, line, scatter, pie): output a \`\`\`chartjs code block containing valid Chart.js config JSON.
- Interactive widgets, mockups, calculators, small tools: output a code block opened with \`\`\`html widget containing self-contained HTML/CSS/JS (no external dependencies).
- Maps / location-based results: output a code block opened with \`\`\`json map containing an array of {name, lat, lng, notes} objects.
Always output the actual code block, not just a text description, so it can be rendered visually. Never mix multiple visual types in one code block. Keep a short explanation before or after the block.

These blocks take priority over the JSON "chart", "location", "architecture" and "timeline" blocks for the same purposes. Ordinary code the user asks for (a Python script, a SQL query, HTML they want to copy) uses its normal language tag — \`\`\`python, \`\`\`sql, plain \`\`\`html — and is never tagged widget or map.

Mermaid rules (parsed by Mermaid 11 — invalid syntax shows as raw code):
- Pick the matching type: \`flowchart TD\`/\`flowchart LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, \`gantt\`, \`mindmap\`, \`pie\`.
- Node IDs are single words (letters, digits, underscores). Put every label in double quotes: \`A["Book appointment"]\`, \`B(["Rounded use case"])\`, \`C{"Paid?"}\`.
- Never put raw quotes, parentheses, brackets or semicolons inside a label without the surrounding double quotes. Write guillemets as «include» and «extend».
- Dashed labeled edge: \`A -. "«include»" .-> B\`. Solid labeled edge: \`A -- "text" --> B\`.
- UML use case diagrams: represent actors as nodes, use cases as rounded boxes inside a subgraph representing the system boundary, and represent «include»/«extend» relationships using labeled dashed edges drawn from the base use case: \`Book -. "«include»" .-> CheckAvailability\`, \`Cancel -. "«extend»" .-> ProcessRefund\`. Use cases are stadium nodes \`(["…"])\`, actors are circle nodes \`(("👤 …"))\` — the chat colours them by role automatically, so don't add classDef/style lines.
- erDiagram: entity names in UPPER_SNAKE_CASE, attributes as \`type name PK|FK\`, relationships like \`USER ||--o{ POST : writes\`.
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
\`\`\`

Chart rules (\`\`\`chartjs):
- Strict JSON only: double-quoted keys, no comments, no functions, no trailing commas.
- Always include "type" ("bar", "line", "scatter", "pie", "doughnut", "radar", "polarArea"), "data.labels" (except scatter) and "data.datasets" with "label" and numeric "data". Add "options.plugins.title" with a short title. Colours are optional — the chat applies its own palette.
Example:
\`\`\`chartjs
{"type":"bar","data":{"labels":["Jan","Feb","Mar"],"datasets":[{"label":"Revenue ($k)","data":[10,15,12]}]},"options":{"plugins":{"title":{"display":true,"text":"Monthly revenue"}}}}
\`\`\`

Widget rules (\`\`\`html widget):
- One self-contained document: inline <style> and <script> only — no CDN links, imports, fonts, images from the web, or network requests.
- It runs in a sandbox with no access to the page, cookies or storage beyond memory. Use a <title> naming the widget. Fit 100% width, look good from 320px wide, and use clear labels, spacing and rounded inputs/buttons.
- Update results live as inputs change; don't rely on alert() or page reloads.

Map rules (\`\`\`json map):
- A JSON array of objects: {"name": "...", "lat": 40.758, "lng": -73.9855, "notes": "short detail"}. Numbers, not strings, for lat/lng.
- Only include places whose coordinates you know; say in the text that locations and details should be checked, since they may be out of date.`;

module.exports = { VISUALS_PROMPT };
