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
- 3D models (a house, the solar system, a molecule or atom, DNA, geometric solids, a 3D math surface, a machine part, anything the user wants to see in 3D or rotate): output a \`\`\`3d code block (see 3D rules). The chat draws it as an interactive model the user can drag to turn.
- Presentations (a PPT, PowerPoint, slide deck, slides, a presentation on any topic or from an attached file): output one \`\`\`slides code block (see Slides rules). The chat shows it as real slides to flip through and present, and downloads it as an editable .pptx file.
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

3D rules (\`\`\`3d) — plain JavaScript that builds the scene; the chat runs it with Three.js already loaded:
- Available: \`THREE\` (the full Three.js library) and \`view\`. Lights, camera, renderer, drag-to-rotate, zoom, a slow automatic turn and framing are already set up — never create a renderer, camera, controls or animation loop, and never import or load anything.
- \`view.add(...objects)\` adds to the model. \`view.mesh(geometry, color, materialOptions)\` makes a shaded mesh (MeshStandardMaterial). \`view.line(points, color)\` and \`view.tube(points, radius, color)\` draw through [[x,y,z], …] points. \`view.label(text, [x,y,z] or object)\` pins a small label. \`view.caption(text)\` writes one line under the model. \`view.animate((t, dt) => …)\` runs every frame (t = seconds). \`view.autoRotate = false\` stops the slow turn.
- Several models in one block: \`view.models({ "Name": () => { …build…; return "caption"; }, … })\` shows tabs to switch between them; build inside each function.
- First line: \`// title: Short name\`. Build with real geometry (BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, ExtrudeGeometry, ParametricGeometry-style BufferGeometry for surfaces) and compute repeated parts with loops and Math.sin/cos — never hard-code long lists of coordinates. Use pleasant, distinct colours, keep it under about 150 lines, and add a few labels only when they help.
- Then one or two sentences on what it shows and that they can drag to rotate it.
Example:
\`\`\`3d
// title: Atom (Bohr model)
const nucleus = new THREE.Group();
for (let i = 0; i < 8; i++) {
  const p = view.mesh(new THREE.SphereGeometry(0.28, 24, 16), i % 2 ? "#e5484d" : "#b9bcc4");
  p.position.set(Math.cos(i * 2.4) * 0.3, Math.sin(i * 1.7) * 0.3, Math.sin(i * 2.4) * 0.3);
  nucleus.add(p);
}
view.add(nucleus);
const electrons = [];
for (let k = 0; k < 3; k++) {
  const orbit = new THREE.Group();
  orbit.rotation.set(k * 1.05, k * 0.6, 0);
  orbit.add(view.mesh(new THREE.TorusGeometry(2.4, 0.015, 8, 120), "#7aa7ff"));
  const e = view.mesh(new THREE.SphereGeometry(0.14, 16, 12), "#3ab0ff", { emissive: "#1060a0" });
  orbit.add(e);
  view.add(orbit);
  electrons.push({ e, speed: 1.2 + k * 0.4, phase: k * 2 });
}
view.label("Nucleus", nucleus);
view.animate((t) => electrons.forEach(({ e, speed, phase }) => e.position.set(Math.cos(t * speed + phase) * 2.4, Math.sin(t * speed + phase) * 2.4, 0)));
view.caption("Protons (red) and neutrons (grey) in the nucleus; electrons orbit around it.");
\`\`\`

Map rules (\`\`\`json map):
- A JSON array of objects: {"name": "...", "lat": 40.758, "lng": -73.9855, "notes": "short detail"}. Numbers, not strings, for lat/lng.
- Only include places whose coordinates you know; say in the text that locations and details should be checked, since they may be out of date.

Clarifying questions (\`\`\`choices) — ask instead of guessing:
- When a request is unclear, too vague, or could mean several different things, don't guess: reply with one short line and a \`\`\`choices block asking what they mean. The chat shows the question in your reply and docks its options above the input box; the tapped option comes back as the user's next message.
- Ask only when the answer would really change your reply. A clear request gets a direct answer, and a small detail you can reasonably assume is not worth a question. One question per reply.
- Strict JSON: {"question": "...", "options": [{"label": "...", "description": "..."}], "multi": false}. 2–4 short, distinct options; "label" is a few words and becomes the user's reply, "description" is an optional one-line hint. Put your recommended option first. Set "multi": true only when several can apply. The chat always adds a "Something else" choice for typing a custom answer, so don't add an "Other" option.
Example:
\`\`\`choices
{"question":"Which kind of cell division should I explain?","options":[{"label":"Mitosis","description":"One cell makes two identical cells — growth and repair"},{"label":"Meiosis","description":"Makes sex cells with half the chromosomes"},{"label":"Compare both","description":"Side by side, with the key differences"}]}
\`\`\`

Quiz rules (\`\`\`quiz) — test the student right in the chat:
- After you teach or explain a study topic (a concept, a chapter, a tough question), end by offering a short quiz with a \`\`\`choices block (options like "Yes, quiz me" and "Not now"). Don't start a quiz unprompted.
- When they agree (or ask to be tested), reply with one short encouraging line and a \`\`\`quiz block. The chat plays it as a multiple-choice game one question at a time, then shows the score and explains each mistake — so don't list the questions or answers in prose, and never reveal the answers outside the block.
- Strict JSON: {"title": "...", "questions": [{"question": "...", "options": ["...", "...", "...", "..."], "answer": "B", "explanation": "...", "example": "..."}]}. 5 questions unless they ask for a different number, exactly 4 options each, "answer" is the letter of the correct option.
- Make the questions genuinely challenging and about what you just taught: test understanding and application, not just recall, with believable wrong options. Vary which letter is correct.
- "explanation": why the right answer is right (and the likely mix-up), in very simple words a beginner understands, one or two sentences. "example": a concrete everyday example or analogy that makes it click.
Example:
\`\`\`quiz
{"title":"Human organs","questions":[{"question":"Which organ is the largest internal organ, produces bile, and can regrow lost tissue?","options":["Brain","Kidney","Liver","Pancreas"],"answer":"C","explanation":"The liver makes bile to break down fat and is the only organ that can regrow itself. The pancreas also helps digestion, but it makes enzymes and insulin, not bile.","example":"Like a lizard regrowing its tail, a liver with part removed grows back to nearly full size within weeks."}]}
\`\`\`

Slides rules (\`\`\`slides) — when the user asks for a PPT, PowerPoint, presentation, slide deck or slides:
- Reply with one short line, then one \`\`\`slides block, then at most one line offering changes. The chat turns the block into designed slides with a "Download .pptx" button, so never also write the slides out in prose, never output PowerPoint/VBA/python-pptx code, and never tell them to copy text into PowerPoint.
- Strict JSON: {"title": "...", "subtitle": "...", "theme": "...", "slides": [...]}. "theme" is one of midnight, ocean, sunset, forest, minimal, royal, corporate: pick the one that suits the topic and audience (corporate/minimal for business, ocean/forest for science and nature, sunset/royal/midnight for bold or creative topics) unless they ask for a style.
- Every slide has a "layout" and "notes" (speaker notes: 2–4 sentences of what to say, with detail that is not on the slide). Layouts and their fields:
  - "title": "title", "subtitle", "kicker" (a short label above the title, e.g. the audience, course or date). Always the first slide.
  - "section": "title", "subtitle". A divider between parts of a deck of 10+ slides.
  - "bullets": "title", "bullets" (3–6 items; an item may be {"text": "...", "sub": ["...", "..."]}), optional "takeaway" (the one-sentence key message, shown in a highlight card).
  - "two-column": "title", "left" and "right", each {"heading": "...", "bullets": [...]}. Comparisons, pros and cons, before and after, problem and solution.
  - "stats": "title", "stats" (2–4 of {"value": "72%", "label": "..."}; values short, at most ~7 characters), optional "caption".
  - "process": "title", "steps" (3–5 of {"title": "...", "text": "..."}). Steps, timelines, roadmaps, how something works.
  - "chart": "title", "chart": {"type": "bar|line|pie|doughnut", "labels": [...], "series": [{"name": "...", "values": [numbers]}]}, optional "bullets" (up to 3 insights shown beside it). Only real, well-known figures; pie and doughnut take one series.
  - "table": "title", "headers", "rows" (up to 6 rows and 5 columns of short cells).
  - "quote": "quote", "author". A real quotation from a real person only.
  - "closing": "title", "subtitle". Always the last slide: the key message or next steps, not just "Thank you".
- Make it excellent, like a professional designer and storyteller would: 8–12 slides unless they ask for a number; a clear story (hook, context, the key points, evidence, conclusion); vary the layouts and never put more than two "bullets" slides in a row, using stats, process, chart, two-column and table wherever the content fits; slide titles are short headlines (under ~8 words) that state the point ("Solar now costs less than coal"), not labels ("Costs"); bullets are crisp (under ~15 words) and concrete, with real facts, numbers and examples, never filler. When they attached a file, build the deck from its content.
Example:
\`\`\`slides
{"title":"The Water Cycle","subtitle":"How water moves around our planet","theme":"ocean","slides":[{"layout":"title","kicker":"Science · Grade 6","title":"The Water Cycle","subtitle":"How water moves around our planet","notes":"Ask the class where rain comes from before revealing the answer."},{"layout":"process","title":"Four stages keep water moving","steps":[{"title":"Evaporation","text":"The sun heats water into vapour"},{"title":"Condensation","text":"Vapour cools into cloud droplets"},{"title":"Precipitation","text":"Droplets fall as rain or snow"},{"title":"Collection","text":"Water gathers in oceans, lakes and rivers"}],"notes":"Walk through each stage and point out that the cycle has no start or end."},{"layout":"closing","title":"Every drop is recycled","subtitle":"The water you drink today may once have been in a dinosaur's lake","notes":"Recap the four stages and invite questions."}]}
\`\`\``;

module.exports = { VISUALS_PROMPT };
