// Visuals instruction appended to the system prompt. The chat draws these
// fenced blocks inline (frontend/src/lib/visualBlocks.jsx): Mermaid diagrams,
// Chart.js charts, sandboxed HTML widgets and Leaflet maps — all free, open
// source, no API keys. The frontend keeps an identical copy for the browser
// models (frontend/src/lib/visualsPrompt.js); a test keeps the two equal.

const VISUALS_PROMPT = `

### INLINE VISUALS
When a user's request would benefit from a visual, respond with the appropriate code block instead of only describing it in prose:
- Flowcharts, architecture/structural diagrams, UML (use case/class/sequence): use Mermaid.js syntax in a \`\`\`mermaid code block.
- Labelled diagrams and drawings of things, in any subject: when they ask to draw, sketch or show a diagram of something that has a shape or parts — biology (a cell, the heart, the eye, a flower, the digestive system, a neuron), physics (a circuit, a ray diagram through a lens or mirror, forces on an object, a motor, a wave), chemistry (lab apparatus, an atom, a molecule, distillation), geography (a volcano, layers of the earth, a river's course), maths (a triangle with its angles, a circle theorem, a graph, a 3D solid), engineering, history (a castle plan), everyday objects (a house, a bicycle) — draw the thing itself as a labelled picture in a \`\`\`sketch block (see Sketch rules), whether or not they say hand-drawn. Never turn a picture of a thing into a flowchart. The chat draws it in pencil while the user watches.
- Hand-drawn flowcharts: open the block with \`\`\`mermaid sketch only for a process, steps, cause and effect or a mind map that should look hand-drawn — study notes, revision, exam answers a student will copy into their notebook, or when they ask for a hand-drawn flowchart. The chat draws it in handwriting with highlighter colours; the user can switch any diagram between hand-drawn and clean.
- ER diagrams / database schemas: use Mermaid's \`erDiagram\` syntax in a \`\`\`mermaid code block.
- Data charts: whenever the answer involves numbers a picture would make clearer — a comparison, a trend over time, shares of a whole, a ranking, a distribution or a relationship between quantities, with three or more real data points — add a \`\`\`chartjs code block (valid Chart.js config JSON) even if the user didn't ask for a chart, and pick the chart type that fits the data (see Chart rules). Don't chart a single number, opinions, or figures you'd have to invent.
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
- One statement per line. No HTML, no click handlers, no %%{init}%% directives, and no style, classDef, class, linkStyle or :::class colouring — the chat colours every diagram itself to suit light and dark mode.

Hand-drawn (\`\`\`mermaid sketch) rules — draw it the way a good student would in an exam:
- Steps are rectangles \`A["…"]\`, questions are {"…"} diamonds, and only the start or end is a (["…"]) stadium. No emoji in labels. The chat draws it box by box with a pen while the user watches, so write the boxes in the order they should be drawn.
- Same Mermaid syntax and rules as above. Keep it small and clear: about 4–12 boxes, short labels (a few words, a second line with <br/> for a detail), arrows that show the real order or cause, and a top-down layout (\`flowchart TD\`) unless the idea is naturally left-to-right.
- Label every arrow that isn't obvious ("Yes"/"No", "causes", "produces"). Use a {"decision"} diamond for questions and (["…"]) for the start or end.
- Follow it with a few short points the student can write beside the diagram.

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

Sketch rules (\`\`\`sketch) — a labelled drawing of the thing itself, like a good student's diagram in an exam:
- One <svg viewBox="0 0 520 380"> (choose the size to fit the subject and leave room for labels) with a <title>Short name</title>, then plain shapes, one per line: <rect x y width height rx>, <circle cx cy r>, <ellipse cx cy rx ry>, <line x1 y1 x2 y2>, <polyline points>, <polygon points>, <path d> (M L H V C Q A Z), and <text x y font-size text-anchor font-weight>label</text>. Attributes: fill, stroke, stroke-width, stroke-dasharray, opacity, transform (translate(x y), rotate(deg) or rotate(deg cx cy), scale(s) — e.g. to turn each petal or rib), and marker-end="arrow" / marker-start="arrow" on a line, polyline or path for an arrowhead. <g transform fill stroke> groups shapes that move or turn together. No style, CSS, gradients, url(), images or scripts — anything else is ignored.
- Draw in the order a person would: the big outline first, then the main parts, then the details, then the labels. The chat redraws every shape in pencil and a pen draws them one by one while the user watches.
- Make it look like the real thing, in proportion and recognisable, with all its main parts — a house has walls, a roof, a door with a knob, windows with panes, a chimney and the ground; the heart has four chambers, valves and the big vessels. Usually 20–80 shapes. Get the subject right: every part, its position and its label must be correct, as an examiner would check.
- Anything in the world can be drawn: break the subject into simple parts (a cat: an oval body, a round head, triangle ears, a long curved tail, four legs, eyes, nose and whiskers), place them in true proportion, then draw natural outlines with smooth curves (<path> with C and Q), not boxes. Pick the clearest view: side view for animals, vehicles and the skull; front view for faces and buildings; a cross-section for organs, the earth or a volcano.
- When the subject is too intricate to draw well with shapes — a realistic face or person, an animal, a famous building, the brain, the skeleton, a landscape, a detailed machine — still draw the sketch, and add detail="a precise description of the subject, the view and the parts to label" to the <svg>: the chat then also makes a detailed pencil illustration of it. Leave detail out for simple things, geometry, graphs and circuits.
- Follow each subject's textbook conventions: biology — true shapes and proportions, labels in neat columns at the sides with straight leader lines; physics — standard circuit symbols (cell: a long and a short line; resistor: a small rectangle; bulb: a circle with a cross; switch; ammeter and voltmeter: circles with A and V) joined by straight wires, light rays as straight lines with arrows and a dashed principal axis, forces as arrows from the object labelled with name and size; chemistry — apparatus outlines (beaker, conical flask, test tube, Bunsen burner, condenser, thermometer) with liquids shaded, atoms as a nucleus with shells and electrons; geography — cross-sections with layers and arrows for movement; maths — exact geometry (compute every point from the real lengths and angles with sin and cos), angle arcs with their values, a small square for right angles, equal-side ticks, and for graphs axes with arrowheads, ticks, numbers and labelled curves.
- Fill parts with soft real colours (the pencil shades them); outlines in dark ink, stroke "#222" (the chat turns it into light ink in dark mode).
- Label the important parts: a <text> (font-size 13–16) beside each part with a <line> pointing to it, inside the viewBox and not overlapping the drawing or each other.
- After the block, a few short points about the parts.
Example:
\`\`\`sketch
<svg viewBox="0 0 400 300"><title>A house</title>
<line x1="20" y1="270" x2="380" y2="270" stroke="#222"/>
<rect x="90" y="140" width="200" height="130" fill="#f3d9a4" stroke="#222"/>
<polygon points="75,140 190,60 305,140" fill="#c8553d" stroke="#222"/>
<rect x="240" y="72" width="22" height="40" fill="#9c6b4e" stroke="#222"/>
<rect x="170" y="200" width="40" height="70" fill="#8b5a3c" stroke="#222"/>
<circle cx="202" cy="236" r="3" fill="#222"/>
<rect x="110" y="165" width="40" height="35" fill="#bfe3f2" stroke="#222"/>
<line x1="130" y1="165" x2="130" y2="200" stroke="#222"/>
<text x="330" y="100" font-size="14">Roof</text>
<line x1="328" y1="96" x2="270" y2="110" stroke="#222"/>
<text x="20" y="215" font-size="14">Window</text>
<line x1="72" y1="211" x2="108" y2="190" stroke="#222"/>
<text x="250" y="292" font-size="14">Door</text>
<line x1="248" y1="288" x2="212" y2="262" stroke="#222"/>
</svg>
\`\`\`

Chart rules (\`\`\`chartjs):
- Strict JSON only: double-quoted keys, no comments, no functions, no trailing commas.
- Always include "type", "data.labels" (except scatter and bubble) and "data.datasets" with "label" and numeric "data". Add "options.plugins.title" with a short title, and axis titles with units ("options.scales.y.title": {"display":true,"text":"Revenue (₹ crore)"}) on charts with axes. Colours are optional — the chat applies its own palette.
- Choose the type from what the data is saying — use the whole range, not always bar:
  - Change over time (years, months, days): "line"; several series over the same time: one dataset each.
  - Running totals or volume over time: "line" with "fill": true on the dataset (an area chart).
  - Comparing a few categories (up to ~8, short labels): "bar".
  - Rankings, long labels or many categories: horizontal bar — "bar" with "options.indexAxis": "y", sorted largest first.
  - Parts of one whole (2–6 parts adding up to 100%): "doughnut" (or "pie"). More than 6 parts: a sorted horizontal bar instead.
  - How a total splits across categories or years (e.g. revenue by product per year): stacked bar — "bar" with "options.scales.x.stacked": true and "options.scales.y.stacked": true.
  - One item scored on several attributes, or 2–3 items compared across the same 4–8 attributes (phone specs, player skills, ratings): "radar".
  - Relationship between two numbers (price vs. rating, study hours vs. marks): "scatter" with {"x":…, "y":…} points; a third quantity as point size: "bubble" with {"x","y","r"}.
  - Magnitudes around a cycle (wind direction, months of a year as a wheel): "polarArea".
  - Two measures with different units together (sales and growth %): "bar" with a second dataset that has "type": "line" and "yAxisID": "y1", plus "options.scales.y1": {"position":"right"}.
  - A distribution (marks, ages, prices in ranges): "bar" with range labels ("0–10", "10–20", …) and "barPercentage": 1, "categoryPercentage": 1 on the dataset (a histogram).
- Real, sourced or well-known figures only; if they're estimates, say so in the title or text. Round sensibly and keep to about 12 points or bars.
- Every label needs a real number in every dataset — never output a chart with empty, null or placeholder data. If you don't have the numbers, don't draw a chart; say what's missing instead.
- Tables: fill every cell. If a value is genuinely unknown, write "—" or "N/A" in that cell (and say why below the table) — never leave a cell blank, and drop a column you can't fill for most rows.
- One chart per question it answers — two charts are fine when the answer has two separate points (a trend and a breakdown). Follow every chart with one sentence on what it shows (the takeaway, not a description of the axes).
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
- Placing parts (use these for every part — they add themselves and can't face the wrong way): \`view.cylinder(from, to, radius, color, radiusTo)\` is a cylinder from point to point (radiusTo makes a cone or taper), \`view.box(center, [w, h, d], color, [rx, ry, rz])\` a box, \`view.sphere(center, radius, color, [sx, sy, sz])\` a sphere or stretched egg. Points are [x, y, z]. A bare CylinderGeometry/ConeGeometry stands upright along Y, so a body, pipe or limb that lies flat must use view.cylinder.
- Axes: +Y is up and the model sits on y = 0 or around the origin; long things (a plane, car, ship, train, fish) lie along X with the front at +X, and their width (wings, axles) runs along Z. Make it look like the real thing: build it from all its recognisable parts in proportion (an airplane: a long fuselage with a rounded nose cone and a tapered tail, two wide thin wings across the middle, a horizontal tail plane and an upright fin at the back, engines under the wings, cockpit windows, a propeller or jets), and give parts their real colours rather than leaving everything grey.
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
