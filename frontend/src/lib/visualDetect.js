// Which visual a fenced block is, judged by what is inside it rather than
// only by its exact tag. Models drift from the tags they are taught: a
// ```chart block holding {"type": "chart", …} was shown to the user as raw
// JSON because only ```json and ```chartjs were drawn. A block the app can
// draw is drawn, whatever it was fenced as; anything else stays code.
//
// Kinds: "structured" (the app's own {"type": "chart" | "timeline" | …}
// blocks), "chartjs", "map", "choices", "quiz", "mermaid".

// The app's own visual blocks (lib/structuredSegments + the interactive ones).
export const STRUCTURED_TYPES = new Set([
  "location", "route", "chart", "timeline", "comparison_table", "comparison", "metrics",
  "architecture", "gallery", "visual_gallery", "collapsible",
  "onboarding", "editor", "results", "mcq",
]);

const CHARTJS_TYPES = new Set(["bar", "line", "pie", "doughnut", "radar", "polarArea", "bubble", "scatter"]);

// Tags that only ever mean "draw this".
const VISUAL_TAGS = /^(chart|charts|chartjs|chart\.js|chart-js|graph|plot|pie|bar|line|visual|visualization|diagram|flowchart|mindmap|sequence|gantt|map|maps|choice|choices|options|quiz|mcq|timeline|metrics|table-chart)$/i;
// Tags a user may ask for as code: drawn only when the content is one of the
// app's own blocks, never a Chart.js config or a place list they asked to see.
const CODE_TAGS = /^(json|jsonc|json5|javascript|js|typescript|ts)$/i;

const MERMAID_START = /^\s*(graph\s+(TD|TB|BT|LR|RL)|flowchart\s+(TD|TB|BT|LR|RL)|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie(\s+title)?\s|mindmap|timeline\s*$|journey|gitGraph|quadrantChart|xychart-beta)/m;

function parseJson(code) {
  try {
    return JSON.parse(String(code).trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

// The chat labels an untagged block "text"; treat it as untagged.
const tagOf = (lang) => {
  const t = String(lang || "").trim();
  return /^(text|plain|plaintext|txt)$/i.test(t) ? "" : t;
};

const isPlace = (p) => p && typeof p === "object"
  && Number.isFinite(Number(p.lat ?? p.latitude)) && Number.isFinite(Number(p.lng ?? p.lon ?? p.longitude));

/** Cheap first look: could this block be a visual at all? */
export function mightBeVisual(lang, code) {
  const tag = tagOf(lang);
  if (VISUAL_TAGS.test(tag)) return true;
  if (tag && !CODE_TAGS.test(tag)) return false;
  const head = String(code || "").trimStart();
  if (!tag && MERMAID_START.test(head)) return true;
  return (head[0] === "{" || head[0] === "[") && /"(type|lat|latitude|question|questions)"\s*:/.test(head);
}

/** The visual `code` (fenced as `lang`) should be drawn as, or null to keep it as code. */
export function detectVisual(lang, code) {
  const tag = tagOf(lang);
  const freeTag = !tag || VISUAL_TAGS.test(tag);
  const text = String(code || "");

  if (freeTag && MERMAID_START.test(text) && !/^\s*[[{]/.test(text)) return { kind: "mermaid", code: text };

  const data = parseJson(text);
  if (data === undefined || data === null || typeof data !== "object") return null;

  if (!Array.isArray(data) && STRUCTURED_TYPES.has(data.type)) return { kind: "structured", data };
  if (!freeTag) return null;

  if (!Array.isArray(data) && CHARTJS_TYPES.has(data.type) && Array.isArray(data.data?.datasets)) return { kind: "chartjs", data };
  const places = Array.isArray(data) ? data : data.places || data.locations;
  if (Array.isArray(places) && places.length && places.every(isPlace)) return { kind: "map", data };
  const questions = Array.isArray(data) ? data : data.questions;
  if (Array.isArray(questions) && questions.length && questions.every((q) => q?.question && Array.isArray(q.options) && (q.answer ?? q.correct) != null)) return { kind: "quiz", data };
  if (!Array.isArray(data) && data.question && Array.isArray(data.options)) return { kind: "choices", data };
  return null;
}
