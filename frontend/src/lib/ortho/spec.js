import { parseLooseJson } from "../looseJson.js";

// An ```ortho block, as a model writes it (rules: lib/orthoRules.js), checked
// and put in one shape: parts (boxes, cylinders and prisms added or cut in
// order), the views and projection, the scale and the dimensions to show.
// Models write the same thing in many ways — {"from":…,"to":…} for a box,
// "diameter" for "d", a 3-number centre for a cylinder — all are read.

const AXIS = { x: 0, y: 1, z: 2 };
const ACROSS = [[1, 2], [0, 2], [0, 1]];

const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v.replace(/mm$/i, "").trim());
  return NaN;
};
const finite = (...vals) => vals.every((v) => Number.isFinite(v));
const point = (v) => {
  if (Array.isArray(v)) return v.map(num);
  if (v && typeof v === "object") return ["x", "y", "z"].filter((k) => k in v).map((k) => num(v[k]));
  return [];
};
const axisOf = (v) => {
  const a = String(v ?? "").trim().toLowerCase().replace(/[^xyz]/g, "")[0];
  return a ? AXIS[a] : undefined;
};

function readBox(part) {
  const b = part.box ?? (/box|block|cuboid|rect/i.test(part.type || part.shape || "") ? part : null);
  if (!b) return null;
  let lo;
  let hi;
  if (Array.isArray(b) && b.length === 6) { lo = b.slice(0, 3).map(num); hi = b.slice(3).map(num); }
  else if (Array.isArray(b) && b.length === 2) { lo = point(b[0]); hi = point(b[1]); }
  else if (b.min || b.from || b.corner1 || b.start) { lo = point(b.min || b.from || b.corner1 || b.start); hi = point(b.max || b.to || b.corner2 || b.end); }
  if ((!lo || !hi) && (b.at || b.origin || b.position) && (b.size || b.dims)) {
    lo = point(b.at || b.origin || b.position);
    const size = point(b.size || b.dims);
    hi = lo.map((v, i) => v + size[i]);
  }
  if (!lo || !hi || lo.length !== 3 || hi.length !== 3 || !finite(...lo, ...hi)) return null;
  const min = lo.map((v, i) => Math.min(v, hi[i]));
  const max = lo.map((v, i) => Math.max(v, hi[i]));
  if (max.some((v, i) => v - min[i] < 1e-6)) return null;
  return { kind: "box", min, max };
}

function readRange(c, axis) {
  let from = num(c.from ?? c.start ?? c.t0);
  let to = num(c.to ?? c.end ?? c.t1);
  const length = num(c.length ?? c.height ?? c.depth);
  if (!Number.isFinite(from) && Array.isArray(c.at) && c.at.length === 3) from = num(c.at[axis]);
  if (!Number.isFinite(to) && Number.isFinite(from) && Number.isFinite(length)) to = from + length;
  if (!finite(from, to)) return null;
  if (to < from) [from, to] = [to, from];
  return to - from > 1e-6 ? [from, to] : null;
}

function readCylinder(part) {
  const c = part.cylinder ?? part.cyl ?? part.hole ?? (/cyl|hole|boss|bore|circle|round/i.test(part.type || part.shape || "") ? part : null);
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const axis = axisOf(c.axis);
  if (axis === undefined) return null;
  let r = num(c.r ?? c.radius);
  if (!Number.isFinite(r)) r = num(c.d ?? c.diameter ?? c.dia) / 2;
  let center = point(c.center ?? c.centre ?? c.at ?? c.c);
  if (center.length === 3) center = ACROSS[axis].map((i) => center[i]);
  const range = readRange(c, axis);
  if (center.length !== 2 || !finite(r, ...center) || r <= 0 || !range) return null;
  return { kind: "cylinder", axis, center, r, from: range[0], to: range[1] };
}

function readPrism(part) {
  const c = part.prism ?? part.extrude ?? part.profile ?? (/prism|extru|wedge|rib|web|profile|polygon/i.test(part.type || part.shape || "") ? part : null);
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const axis = axisOf(c.axis);
  if (axis === undefined) return null;
  let points = (Array.isArray(c.points) ? c.points : Array.isArray(c.profile) ? c.profile : []).map(point);
  if (points.some((p) => p.length === 3)) points = points.map((p) => (p.length === 3 ? ACROSS[axis].map((i) => p[i]) : p));
  points = points.filter((p) => p.length === 2 && finite(...p));
  // A repeated last point closes nothing new.
  const [first] = points;
  const last = points[points.length - 1];
  if (points.length > 3 && first && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) points.pop();
  const range = readRange(c, axis);
  if (points.length < 3 || !range) return null;
  let area = 0;
  points.forEach((p, i) => { const q = points[(i + 1) % points.length]; area += p[0] * q[1] - q[0] * p[1]; });
  if (Math.abs(area) < 1e-6) return null;
  return { kind: "prism", axis, points, from: range[0], to: range[1] };
}

function readCone(part) {
  const c = part.cone ?? part.frustum ?? part.countersink ?? (/cone|frustum|countersink|taper|chamfer/i.test(part.type || part.shape || "") ? part : null);
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const axis = axisOf(c.axis);
  if (axis === undefined) return null;
  const radius = (r, d) => (Number.isFinite(num(r)) ? num(r) : num(d) / 2);
  const r1 = radius(c.r1 ?? c.r ?? c.radius ?? c.baseRadius, c.d1 ?? c.d ?? c.diameter ?? c.baseD ?? c.baseDiameter);
  let r2 = radius(c.r2 ?? c.topRadius, c.d2 ?? c.topD ?? c.topDiameter);
  if (!Number.isFinite(r2)) r2 = 0; // to a point
  let center = point(c.center ?? c.centre ?? c.at ?? c.c);
  if (center.length === 3) center = ACROSS[axis].map((i) => center[i]);
  const range = readRange(c, axis);
  if (center.length !== 2 || !finite(r1, r2, ...center) || r1 < 0 || r2 < 0 || r1 + r2 <= 0 || !range) return null;
  // "from" is the end with radius r1, whichever way round they were written.
  const flipped = num(c.from ?? c.start) > num(c.to ?? c.end);
  return { kind: "cone", axis, center, r1: flipped ? r2 : r1, r2: flipped ? r1 : r2, from: range[0], to: range[1] };
}

function readPyramid(part) {
  const c = part.pyramid ?? (/pyramid/i.test(part.type || part.shape || "") ? part : null);
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const prism = readPrism({ prism: c });
  if (!prism) return null;
  let apex = point(c.apex ?? c.tip ?? c.top_center);
  if (apex.length === 3) apex = ACROSS[prism.axis].map((i) => apex[i]);
  if (apex.length !== 2 || !finite(...apex)) {
    apex = [0, 1].map((n) => prism.points.reduce((sum, q) => sum + q[n], 0) / prism.points.length);
  }
  let top = num(c.topScale ?? c.top ?? 0);
  if (!Number.isFinite(top) || top < 0 || top >= 1) top = 0;
  // "points" is the base, at "from"; it narrows to the apex at "to".
  const flipped = num(c.from ?? c.start) > num(c.to ?? c.end);
  if (flipped) return null;
  return { kind: "pyramid", axis: prism.axis, points: prism.points, apex, top, from: prism.from, to: prism.to };
}

const VIEW_NAMES = [
  [/^(front|elevation|fv|front view|front elevation)$/, "front"],
  [/^(top|plan|tv|top view|plan view)$/, "top"],
  [/^(left|lh|lhs|left side|left side view|left view|lsv|left hand side view|left end view)$/, "left"],
  [/^(right|rh|rhs|right side|right side view|right view|rsv|right hand side view|right end view)$/, "right"],
  [/^(side|side view|end view|profile|sv|side elevation|end elevation)$/, "side"],
];
const viewName = (v) => {
  const s = String(v ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return VIEW_NAMES.find(([re]) => re.test(s))?.[1];
};

function readScale(v) {
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const factor = Number(m[1]) / Number(m[2]);
  return factor > 0 && factor <= 20 ? { label: `${m[1]}:${m[2]}`, factor } : null;
}

const clean = (s, max) => String(s ?? "").replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * `{ spec }` from the block's text, or `{ error }` saying what is wrong, in
 * words the user can act on.
 */
export function parseOrthoSpec(text) {
  let raw = null;
  try { raw = parseLooseJson(String(text || "")); } catch { raw = null; }
  if (!raw || typeof raw !== "object") return { error: "The drawing's description isn't readable." };
  const source = Array.isArray(raw) ? { parts: raw } : raw;
  const list = Array.isArray(source.parts) ? source.parts : Array.isArray(source.solids) ? source.solids : Array.isArray(source.features) ? source.features : [];
  const parts = [];
  const skipped = [];
  for (const [i, item] of list.slice(0, 80).entries()) {
    if (!item || typeof item !== "object") continue;
    const op = /cut|sub|remov|hole|minus|diff|drill|slot|notch|groove|pocket|bore/i.test(String(item.op ?? item.operation ?? item.mode ?? "")) || /^(hole|slot|cut)$/i.test(String(item.type || "")) ? "cut" : "add";
    const shape = readBox(item) || readPyramid(item) || readCone(item) || readCylinder(item) || readPrism(item);
    const name = clean(item.name ?? item.label ?? `part ${i + 1}`, 40);
    if (shape) parts.push({ op, name, ...shape });
    else skipped.push(name);
  }
  if (!parts.some((p) => p.op === "add")) {
    return { error: skipped.length ? `The parts couldn't be read (${skipped.slice(0, 3).join(", ")}).` : "The drawing has no parts to draw." };
  }
  const projection = /third|3rd|american|ansi|usa?\b/i.test(String(source.projection ?? source.angle ?? "")) ? "third" : "first";
  const side = projection === "first" ? "left" : "right";
  const asked = (Array.isArray(source.views) ? source.views : []).map(viewName).filter(Boolean).map((v) => (v === "side" ? side : v));
  const sideView = asked.find((v) => v === "left" || v === "right") || side;
  const views = ["front", ...(asked.length && !asked.includes("top") ? [] : ["top"]), ...(asked.length && !asked.some((v) => v === "left" || v === "right") ? [] : [sideView])];
  const dims = (Array.isArray(source.dims) ? source.dims : Array.isArray(source.dimensions) ? source.dimensions : []).slice(0, 60).map((d) => {
    if (!d || typeof d !== "object") return null;
    let view = viewName(d.view);
    if (view === "side" || view === "left" || view === "right") view = "side";
    const axis = axisOf(d.axis ?? d.along ?? d.direction);
    let from = d.from;
    let to = d.to;
    if (Array.isArray(d.between)) [from, to] = d.between;
    if (Array.isArray(from) && axis !== undefined) from = from[axis];
    if (Array.isArray(to) && axis !== undefined) to = to[axis];
    from = num(from);
    to = num(to);
    if (axis === undefined || !finite(from, to) || Math.abs(to - from) < 1e-6) return null;
    const sideOf = String(d.side ?? d.place ?? "").toLowerCase();
    return { view: view || null, axis, from: Math.min(from, to), to: Math.max(from, to), side: ["top", "bottom", "left", "right"].includes(sideOf) ? sideOf : null };
  }).filter(Boolean);
  const titles = source.titles && typeof source.titles === "object" ? source.titles : {};
  return {
    spec: {
      title: clean(source.title ?? source.name ?? "Orthographic projection", 60) || "Orthographic projection",
      projection,
      views,
      sideView,
      scale: readScale(source.scale),
      dims,
      parts,
      skipped,
      titles: Object.fromEntries(Object.entries(titles).map(([k, v]) => [viewName(k) === "side" ? sideView : viewName(k), clean(v, 40)]).filter(([k, v]) => k && v)),
      material: clean(source.material, 30),
    },
  };
}
