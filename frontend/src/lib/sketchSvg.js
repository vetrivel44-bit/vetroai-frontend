// A hand-drawn picture (```sketch block): the model writes a small SVG of the
// thing asked for — a house, the heart, a plant cell — and the chat redraws
// each shape in pencil (components/chat/visuals/SketchBlock.jsx).
//
// Only plain shapes and text are read, and only known attributes with checked
// values, so nothing the model writes can run or load anything. Whole
// elements only: while the block streams, the shapes written so far are drawn.

const SHAPES = "rect|circle|ellipse|line|polyline|polygon|path";
const ELEMENT_RE = new RegExp(`<(${SHAPES})\\b([^<>]*?)\\/?>|<text\\b([^<>]*)>([^<]*)<\\/text>`, "gi");
const ATTR_RE = /([a-zA-Z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

const NUMBER_ATTRS = ["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "stroke-width", "font-size"];
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
const POINTS_RE = /^[\d\s.,eE+-]+$/;
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]+$/;

function attrsOf(source) {
  const out = {};
  for (const m of String(source || "").matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    const value = (m[3] ?? m[4] ?? "").trim();
    if (NUMBER_ATTRS.includes(name)) {
      const n = parseFloat(value);
      if (Number.isFinite(n)) out[name] = n;
    } else if ((name === "fill" || name === "stroke") && (value === "none" || COLOR_RE.test(value))) {
      out[name] = value;
    } else if (name === "points" && POINTS_RE.test(value)) {
      out.points = value.trim().split(/[\s,]+/).map(Number).reduce((pts, n, i, all) => (i % 2 ? pts : [...pts, [n, all[i + 1]]]), []).filter((p) => p.every(Number.isFinite));
    } else if (name === "d" && PATH_RE.test(value)) {
      out.d = value;
    } else if (name === "text-anchor" && /^(start|middle|end)$/.test(value)) {
      out["text-anchor"] = value;
    } else if (name === "font-weight" && /^(normal|bold|[1-9]00)$/.test(value)) {
      out["font-weight"] = value;
    } else if (name === "stroke-dasharray" && /^[\d\s.,]+$/.test(value)) {
      out["stroke-dasharray"] = value;
    }
  }
  return out;
}

const decode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function parseSketch(code) {
  const text = String(code || "");
  const viewBox = text.match(/<svg\b[^>]*\bviewBox\s*=\s*["']\s*([\d.\-\s,]+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
  const title = decode(text.match(/<title>([^<]{1,80})<\/title>/i)?.[1] || "").trim();
  const items = [];
  for (const m of text.matchAll(ELEMENT_RE)) {
    if (m[1]) items.push({ tag: m[1].toLowerCase(), attrs: attrsOf(m[2]) });
    else if (m[4]?.trim()) items.push({ tag: "text", attrs: attrsOf(m[3]), text: decode(m[4]).trim().slice(0, 120) });
  }
  return {
    viewBox: viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox : [0, 0, 400, 300],
    title,
    items: items.filter(drawable).slice(0, 400),
  };
}

function drawable({ tag, attrs: a }) {
  if (tag === "rect") return a.width > 0 && a.height > 0;
  if (tag === "circle") return a.r > 0;
  if (tag === "ellipse") return a.rx > 0 && a.ry > 0;
  if (tag === "line") return ["x1", "y1", "x2", "y2"].every((k) => k in a);
  if (tag === "polyline" || tag === "polygon") return a.points?.length >= 2;
  if (tag === "path") return Boolean(a.d);
  return tag === "text";
}

// Near-black ink reads as nothing on a dark page: it becomes the theme's ink.
export function isInkColor(c) {
  if (!c || /^black$/i.test(c)) return true;
  let hex = String(c).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return false;
  if (hex.length === 3) hex = hex.replace(/./g, "$&$&");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
}
