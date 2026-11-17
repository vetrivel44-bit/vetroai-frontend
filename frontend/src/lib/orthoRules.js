// Engineering drawings — "orthographic projection of the machine block",
// "draw the front, top and side views", "first angle projection, BIS". Drawn
// freehand (a ```sketch) or by an image model they came out wrong: views that
// don't line up, hidden lines missing, the object itself changed. So the
// model only describes the solid, in an ```ortho block, and the app works
// every view out exactly (lib/ortho/).

// Any one of these is an engineering drawing question.
const STRONG = /\b(ortho-?graphic|(?:first|third|1st|3rd)[- ]angle|engineering (?:drawing|graphics)|machine drawing|technical drawing|projections? of (?:solids?|the (?:block|object|solid|component|part|bracket|casting))|(?:front|side|end) elevation|plan and elevation|elevation and plan|miter line|mitre line|hidden lines?)\b/i;
// Views of a thing…
const VIEW = /\b(front view|top view|plan view|side view|end view|left (?:hand )?(?:side )?view|right (?:hand )?(?:side )?view|lh(?:s)? view|rh(?:s)? view|bottom view|rear view)\b/gi;
// …that is a made object rather than an animal or a building.
const SOLID = /\b(block|bracket|bearing|pulley|shaft|collar|bush|flange|plate|base|rib|web|slot|holes?|bore|boss|prism|pyramid|cylinder|cone|frustum|cube|cuboid|v-?block|casting|component|machine part|dimensions?|\d+\s?mm|mm\b|chamfer|counterbore|countersink|keyway|step(?:ped)? block|guide|support|stand|lever|clamp)\b/i;

export function isOrthoRequest(text) {
  const t = String(text || "");
  if (STRONG.test(t)) return true;
  const views = new Set((t.match(VIEW) || []).map((v) => v.toLowerCase().replace(/\s+/g, " ")));
  return views.size >= 2 || (views.size === 1 && SOLID.test(t));
}

export const ORTHO_RULES = `Engineering drawing rules (\`\`\`ortho) — orthographic projections: front, top and side views (first or third angle) of a machine block, bracket, bearing, support or any solid made of blocks, cylinders, prisms, pyramids and cones. Never draw these freehand in a \`\`\`sketch or as an image: describe the solid in one \`\`\`ortho block of JSON, and the app works out every view exactly — visible and hidden lines, centre lines, the 45° miter line, dimensions, the title block and the projection symbol.
- Axes in mm. x: length, left → right as seen in the front view. y: height, from the bottom (0) up. z: depth, from the front face (0) to the back. The front view looks at the z = 0 face: the side the question's arrow (X) points at, or else the side that shows the most.
- "parts" builds the solid in order: {"op": "add"} adds material; {"op": "cut"} removes material from what is there so far (holes, slots, notches, steps, grooves). Each part is one shape:
  "box": [x0, y0, z0, x1, y1, z1] — two opposite corners.
  "cylinder": {"axis": "x"|"y"|"z", "center": [a, b], "d": diameter, "from": start, "to": end} — center is the other two coordinates in x-y-z order (axis "z": [x, y]; axis "y": [x, z]; axis "x": [y, z]); from and to run along the axis.
  "prism": {"axis", "from", "to", "points": [[a, b], …]} — a flat outline (the other two coordinates, in x-y-z order) pushed along the axis: ribs, webs, wedges, sloping faces, V-blocks, L and T sections, hexagonal prisms.
  "cone": {"axis", "center", "d1": diameter at from, "d2": diameter at to (0 for a point), "from", "to"} — cones, frustums, countersinks, chamfers round a hole.
  "pyramid": {"axis", "from", "to", "points": the base outline at from, "apex": [a, b]} — narrows to the apex at to.
- Work every number out from the question before writing. A rib reaching "35 from the front edge" ends at z = 35; a hole "50 from the left, 40 above the base" is centred at x = 50, y = 40; a part standing on a 15-thick base starts at y = 15. A hole through a wall runs exactly from the wall's front face to its back face (a 15-thick back wall at z 45–60: "from": 45, "to": 60). Check each part against the question: its size, its position, which face it is on.
- "dims": every size and position the question gives, each in the view where the feature shows its true shape: {"view": "front"|"top"|"side", "axis": "x"|"y"|"z", "from": a, "to": b} — two coordinates along that axis. Overall sizes, hole diameters (Ø) and radii (R) are added by the app.
- Also "title" (the object's name), "projection": "first" (BIS, India, ISO) unless the question says third angle, "scale": "1:1" unless another is asked, "views": ["front", "top", "left"] (in first angle the left view is drawn on the right of the front view), and "material" if given.
- Not for a solid tilted to the planes (axis inclined to HP or VP), sections, developments or isometric drawings: draw those as a \`\`\`sketch.
Example — an L-bracket; it only shows the format, so build the object in the question:
\`\`\`ortho
{"title": "L-bracket", "projection": "first", "scale": "1:1", "views": ["front", "top", "left"],
 "parts": [{"op": "add", "name": "base", "box": [0, 0, 0, 80, 10, 40]},
  {"op": "add", "name": "upright", "box": [0, 0, 30, 80, 50, 40]},
  {"op": "cut", "name": "hole", "cylinder": {"axis": "z", "center": [40, 32], "d": 16, "from": 30, "to": 40}}],
 "dims": [{"view": "front", "axis": "y", "from": 0, "to": 10}, {"view": "front", "axis": "y", "from": 0, "to": 32}, {"view": "front", "axis": "x", "from": 0, "to": 40}, {"view": "side", "axis": "z", "from": 30, "to": 40}]}
\`\`\``;

export function orthoInstruction() {
  return [
    "[ENGINEERING DRAWING — FOLLOW EXACTLY]",
    "The user's message is an engineering drawing (orthographic projection) question. VetroAI draws the sheet itself from a description of the solid, so every view is exact.",
    "Reply with one short line, then exactly one ```ortho block (the rules are below), then 3–6 short points: how the object was read (which face is the front, where each feature is) and which lines are hidden.",
    "Do NOT draw it in a ```sketch, as an image, as ASCII art or as a table of views, and don't describe the views instead of giving the block.",
    ORTHO_RULES,
  ].join("\n");
}
