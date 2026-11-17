// Doodle → picture: draw something rough with a finger, and the image model
// turns it into a finished picture or a clean labelled diagram, keeping what
// you drew where you drew it (DoodlePad.jsx; App.jsx runDoodleJob sends it
// with editImage, the doodle as the picture to work from).

/** The looks a doodle can become. `short` names the result in the chat. */
export const DOODLE_STYLES = [
  { id: "illustration", label: "Illustration", short: "an illustration", look: "a polished, colourful digital illustration with clean shapes and soft shading" },
  { id: "photo", label: "Realistic", short: "a realistic photo", look: "a realistic, high-quality photograph, with natural light and real textures" },
  { id: "watercolour", label: "Watercolour", short: "a watercolour painting", look: "a soft watercolour painting on textured paper, with gentle washes of colour" },
  { id: "cartoon", label: "Cartoon", short: "a cartoon", look: "a cute, clean cartoon with bold outlines and bright flat colours" },
  { id: "3d", label: "3D", short: "a 3D render", look: "a 3D rendered scene with soft studio lighting and smooth materials" },
  { id: "pencil", label: "Pencil", short: "a pencil drawing", look: "a detailed graphite pencil drawing with careful shading, on white paper" },
  { id: "diagram", label: "Diagram", short: "a clean diagram", look: "a clean, accurate diagram like a textbook figure: neat outlines, flat colours, and clear labels with straight leader lines, on a white background" },
];

export const DEFAULT_STYLE = "illustration";

export const styleOf = (id) => DOODLE_STYLES.find((s) => s.id === id) || DOODLE_STYLES[0];

/**
 * What the image model is asked: turn this doodle into `style`, keeping its
 * composition. `description` (optional) says what it is; without one the
 * model works it out from the shapes. `again`: a fresh take on the same doodle.
 */
export function doodlePrompt({ description = "", style = DEFAULT_STYLE, again = false } = {}) {
  const s = styleOf(style);
  const what = String(description || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const lines = [
    `The supplied image is a rough hand-drawn doodle${what ? ` of ${what}` : ""}. Turn it into ${s.look}.`,
    "Keep the doodle's composition: the same things, in the same places, at the same sizes and in the same poses, and its colours where it has them. Draw everything properly and in full detail, as a skilled artist would have drawn it.",
    what ? "" : "Work out what the doodle shows from its shapes and colours.",
    s.id === "diagram"
      ? "Label the parts in English. No other text."
      : "No text, captions or signature in the picture.",
    "Don't show the doodle itself, the paper or any drawing tools. Make every character original: don't turn it into a known cartoon, film or game character, a logo or a brand.",
    again ? "This is a new take: vary the details, lighting and finish from any earlier version while keeping the composition." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** The chat's words for what was asked: "Turn my doodle into a cartoon: a cat on a sofa". */
export function doodleRequestText({ description = "", style = DEFAULT_STYLE } = {}) {
  const what = String(description || "").replace(/\s+/g, " ").trim();
  return `Turn my doodle into ${styleOf(style).short}${what ? `: ${what}` : ""}`;
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** The pen's colours: ink first. */
export const PEN_COLOURS = ["#1f1e1d", "#e5484d", "#f08c00", "#f5c518", "#2f9e44", "#1c7ed6", "#7048e8", "#8d5524", "#ffffff"];
/** Pen widths, in the pad's own units (it's 1024 across). */
export const PEN_SIZES = { S: 6, M: 14, L: 30 };

/**
 * A stroke's points as smooth curve segments: the midpoint between each pair
 * of points is a curve end, each point its control (quadratic smoothing), so
 * a finger's jagged path draws as a clean line. [{ from, control, to }].
 */
export function smoothSegments(points) {
  const list = (points || []).filter((p) => Array.isArray(p) && p.length >= 2);
  if (list.length < 2) return [];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const segments = [];
  let from = list[0];
  for (let i = 1; i < list.length - 1; i++) {
    const to = mid(list[i], list[i + 1]);
    segments.push({ from, control: list[i], to });
    from = to;
  }
  const last = list[list.length - 1];
  segments.push({ from, control: last, to: last });
  return segments;
}

/** Has anything been drawn (a stroke with ink, not only rubbing out) or a photo added? */
export function hasDrawing(strokes, background = null) {
  return Boolean(background) || (strokes || []).some((s) => !s.erase && (s.points || []).length > 0);
}
