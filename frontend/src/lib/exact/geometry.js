import { parseLooseJson } from "../looseJson.js";
import { INK, clean, fmt, line, num, poly, r2, sheet, text } from "./svg.js";

// ```geometry — a geometry figure built from what the question gives: a
// triangle from its sides and angles, midpoints, feet of perpendiculars,
// points at a distance and angle, intersections, centres, tangents, circles.
// The app works out every coordinate, so lengths and angles are true and a
// "right angle" is square — the model never places points by eye.

const RAD = Math.PI / 180;
const isName = (s) => typeof s === "string" && /^[A-Za-z][\w′']{0,3}$/.test(s);
const pairOf = (v) => {
  if (Array.isArray(v) && v.length === 2 && v.every(isName)) return v;
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, "");
    if (/^[A-Za-z][\w′']*-[A-Za-z][\w′']*$/.test(s)) return s.split("-");
    if (/^[A-Z][′']?[A-Z][′']?$/.test(s)) return s.match(/[A-Z][′']?/g);
  }
  return null;
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const dist = (a, b) => len(sub(a, b));

function lineMeet(p1, p2, p3, p4) {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den;
  return add(p1, mul(d1, t));
}
function circumcenter(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s = (p) => p[0] * p[0] + p[1] * p[1];
  return [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
}
function incenter(a, b, c) {
  const la = dist(b, c);
  const lb = dist(a, c);
  const lc = dist(a, b);
  const p = la + lb + lc;
  return [(la * a[0] + lb * b[0] + lc * c[0]) / p, (la * a[1] + lb * b[1] + lc * c[1]) / p];
}
const foot = (p, a, b) => {
  const d = sub(b, a);
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1);
  return add(a, mul(d, t));
};

// A triangle from what is known of it: three sides, two sides and the angle
// between, a side and two angles, or a right angle with the hypotenuse.
function solveTriangle(t) {
  const name = String(t.name ?? t.vertices ?? "ABC").replace(/[^A-Za-z′']/g, "");
  const [A, B, C] = name.match(/[A-Za-z][′']?/g) || ["A", "B", "C"];
  const side = (p, q) => num(t[p + q] ?? t[q + p] ?? t[`side${p}${q}`] ?? t[`side${q}${p}`]);
  const angle = (p) => num(t[`angle${p}`] ?? t[`angle_${p}`] ?? t[`∠${p}`] ?? t[p]);
  let a = side(B, C);
  let b = side(A, C);
  let c = side(A, B);
  let angA = angle(A);
  let angB = angle(B);
  let angC = angle(C);
  const type = String(t.type ?? "").toLowerCase();
  if (/equilateral/.test(type)) { const s = num(t.side) || c || a || b; a = b = c = s; }
  const ok = Number.isFinite;
  const known = () => [ok(angA), ok(angB), ok(angC)].filter(Boolean).length;
  if (known() === 2) {
    if (!ok(angA)) angA = 180 - angB - angC;
    if (!ok(angB)) angB = 180 - angA - angC;
    if (!ok(angC)) angC = 180 - angA - angB;
  }
  const sin = (d) => Math.sin(d * RAD);
  if (known() === 3 && !ok(c)) {
    if (ok(a)) c = (a * sin(angC)) / sin(angA);
    else if (ok(b)) c = (b * sin(angC)) / sin(angB);
  }
  // Two sides and the angle between them: the third side.
  if (!ok(a) && ok(b) && ok(c) && ok(angA)) a = Math.sqrt(b * b + c * c - 2 * b * c * Math.cos(angA * RAD));
  if (!ok(b) && ok(a) && ok(c) && ok(angB)) b = Math.sqrt(a * a + c * c - 2 * a * c * Math.cos(angB * RAD));
  if (!ok(c) && ok(a) && ok(b) && ok(angC)) c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(angC * RAD));
  // A right angle and two sides (RHS).
  if (known() >= 1 && [a, b, c].filter(ok).length === 2) {
    if (angA === 90 && !ok(a)) a = Math.sqrt(b * b + c * c);
    if (angA === 90 && !ok(b)) b = Math.sqrt(a * a - c * c);
    if (angA === 90 && !ok(c)) c = Math.sqrt(a * a - b * b);
    if (angB === 90 && !ok(b)) b = Math.sqrt(a * a + c * c);
    if (angB === 90 && !ok(a)) a = Math.sqrt(b * b - c * c);
    if (angB === 90 && !ok(c)) c = Math.sqrt(b * b - a * a);
    if (angC === 90 && !ok(c)) c = Math.sqrt(a * a + b * b);
    if (angC === 90 && !ok(a)) a = Math.sqrt(c * c - b * b);
    if (angC === 90 && !ok(b)) b = Math.sqrt(c * c - a * a);
  }
  if (known() === 3 && ok(c) && !ok(b)) b = (c * sin(angB)) / sin(angC);
  if (![a, b, c].every((v) => ok(v) && v > 0)) {
    if (ok(c) && ok(b) && ok(angA)) a = Math.sqrt(b * b + c * c - 2 * b * c * Math.cos(angA * RAD));
  }
  if (![a, b, c].every((v) => ok(v) && v > 0)) return { error: `Triangle ${name} needs three facts: three sides, two sides and the angle between them, or one side and two angles.` };
  if (a + b <= c + 1e-9 || a + c <= b + 1e-9 || b + c <= a + 1e-9) return { error: `No triangle has sides ${fmt(a)}, ${fmt(b)} and ${fmt(c)}.` };
  const cosA = (b * b + c * c - a * a) / (2 * b * c);
  const A0 = Math.acos(Math.max(-1, Math.min(1, cosA)));
  return { points: { [A]: [0, 0], [B]: [c, 0], [C]: [b * Math.cos(A0), b * Math.sin(A0)] } };
}

function readCircle(c, P, named) {
  if (typeof c === "string") return named[c] || null;
  if (!c || typeof c !== "object") return null;
  if (Array.isArray(c.through) && c.through.length === 3) {
    const pts = c.through.map((n) => P[n]);
    if (pts.some((p) => !p)) return null;
    const o = circumcenter(...pts);
    return o ? { o, r: dist(o, pts[0]) } : null;
  }
  if (Array.isArray(c.incircle ?? c.inscribed)) {
    const pts = (c.incircle ?? c.inscribed).map((n) => P[n]);
    if (pts.length !== 3 || pts.some((p) => !p)) return null;
    const o = incenter(...pts);
    return { o, r: dist(o, foot(o, pts[0], pts[1])) };
  }
  const o = typeof c.center === "string" ? P[c.center] : Array.isArray(c.center) ? c.center.map(num) : typeof c.centre === "string" ? P[c.centre] : null;
  if (!o) return null;
  let r = num(c.r ?? c.radius);
  if (!(r > 0) && num(c.d ?? c.diameter) > 0) r = num(c.d ?? c.diameter) / 2;
  if (!(r > 0) && typeof c.through === "string" && P[c.through]) r = dist(o, P[c.through]);
  return r > 0 ? { o, r } : null;
}

// One point from its definition, or null while what it needs isn't known.
function definePoint(def, P, named) {
  if (Array.isArray(def) && def.length === 2 && def.every((v) => Number.isFinite(num(v)))) return def.map(num);
  if (!def || typeof def !== "object") return null;
  if (Number.isFinite(num(def.x)) && Number.isFinite(num(def.y))) return [num(def.x), num(def.y)];
  const get = (n) => (typeof n === "string" ? P[n] : null);
  const two = (v) => { const p = pairOf(v); return p && P[p[0]] && P[p[1]] ? [P[p[0]], P[p[1]]] : null; };
  const mid = two(def.mid ?? def.midpoint);
  if (mid) return mul(add(mid[0], mid[1]), 0.5);
  const on = two(def.on ?? def.along);
  if (on && def.foot == null) {
    const d = sub(on[1], on[0]);
    if (Number.isFinite(num(def.dist ?? def.distance))) return add(on[0], mul(unit(d), num(def.dist ?? def.distance)));
    if (Array.isArray(def.ratio) && def.ratio.length === 2) { const [m, n] = def.ratio.map(num); return add(on[0], mul(d, m / (m + n))); }
    return add(on[0], mul(d, Number.isFinite(num(def.t)) ? num(def.t) : 0.5));
  }
  if (def.foot != null || def.perpendicularFrom != null) {
    const p = get(def.foot ?? def.perpendicularFrom);
    const l = two(def.on ?? def.to);
    return p && l ? foot(p, l[0], l[1]) : null;
  }
  if (def.from != null && (def.angle != null || def.turn != null) && def.dist != null) {
    const o = get(def.from);
    if (!o) return null;
    let a = num(def.angle ?? 0);
    if (def.toward != null) {
      const t = get(def.toward);
      if (!t) return null;
      a = Math.atan2(t[1] - o[1], t[0] - o[0]) / RAD + num(def.turn ?? def.angle ?? 0);
    }
    return add(o, mul([Math.cos(a * RAD), Math.sin(a * RAD)], num(def.dist)));
  }
  if (Array.isArray(def.intersect) && def.intersect.length === 2) {
    const l1 = two(def.intersect[0]);
    const l2 = two(def.intersect[1]);
    return l1 && l2 ? lineMeet(l1[0], l1[1], l2[0], l2[1]) : null;
  }
  for (const [key, fn] of [["centroid", (a, b, c) => mul(add(add(a, b), c), 1 / 3)], ["circumcenter", circumcenter], ["incenter", incenter],
    ["orthocenter", (a, b, c) => lineMeet(a, foot(a, b, c), b, foot(b, a, c))]]) {
    if (Array.isArray(def[key]) || typeof def[key] === "string") {
      const names = Array.isArray(def[key]) ? def[key] : def[key].match(/[A-Z][′']?/g) || [];
      const pts = names.map(get);
      return pts.length === 3 && pts.every(Boolean) ? fn(...pts) : null;
    }
  }
  if (def.reflect != null) {
    const p = get(def.reflect);
    if (!p) return null;
    const l = two(def.over);
    if (l) { const f = foot(p, l[0], l[1]); return sub(mul(f, 2), p); }
    const o = get(def.through);
    return o ? sub(mul(o, 2), p) : null;
  }
  if (def.onCircle != null) {
    const c = readCircle(def.onCircle, P, named);
    return c ? add(c.o, mul([Math.cos(num(def.angle ?? 0) * RAD), Math.sin(num(def.angle ?? 0) * RAD)], c.r)) : null;
  }
  if (def.tangentFrom != null) {
    const p = get(def.tangentFrom);
    const c = readCircle(def.circle, P, named);
    if (!p || !c) return null;
    const d = dist(p, c.o);
    if (d <= c.r) return null;
    const base = Math.atan2(p[1] - c.o[1], p[0] - c.o[0]);
    const spread = Math.acos(c.r / d);
    const a = base + (num(def.which) === 2 ? -spread : spread);
    return add(c.o, mul([Math.cos(a), Math.sin(a)], c.r));
  }
  return null;
}

export function parseGeometry(input) {
  let raw = null;
  try { raw = parseLooseJson(String(input || "")); } catch { raw = null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "The figure's description isn't readable." };
  const P = {};
  const named = {};
  const triangles = [raw.triangle, ...(Array.isArray(raw.triangles) ? raw.triangles : [])].filter((t) => t && typeof t === "object");
  for (const t of triangles) {
    const solved = solveTriangle(t);
    if (solved.error) return { error: solved.error };
    for (const [k, v] of Object.entries(solved.points)) if (!P[k]) P[k] = v;
  }
  const defs = raw.points && typeof raw.points === "object" ? raw.points : {};
  // Each point once what it depends on is known.
  let pending = Object.entries(defs).filter(([k]) => !P[k]);
  for (let pass = 0; pass < 12 && pending.length; pass++) {
    for (const c of Array.isArray(raw.circles) ? raw.circles : []) if (c?.name && !named[c.name]) { const got = readCircle(c, P, named); if (got) named[c.name] = got; }
    const next = [];
    for (const [k, def] of pending) {
      const p = definePoint(def, P, named);
      if (p && p.every(Number.isFinite)) P[k] = p; else next.push([k, def]);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  if (pending.length) return { error: `Couldn't place ${pending.map(([k]) => k).slice(0, 4).join(", ")} from the description.` };
  if (Object.keys(P).length < 2 && !(Array.isArray(raw.circles) && raw.circles.length)) return { error: "The figure has nothing to draw." };
  return { spec: { raw, P, named, title: clean(raw.title ?? "", 70), unit: clean(raw.unit ?? raw.units ?? "cm", 6) } };
}

/** A ```geometry block → `{ title, svg, width, height }` or `{ error }`. */
export function renderGeometry(code) {
  const { spec, error } = parseGeometry(code);
  if (error) return { error };
  const { raw, P, named, unit: u } = spec;
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const missing = new Set();
  const ends = (s) => {
    const pr = pairOf(s) || (s && typeof s === "object" ? pairOf([s.from, s.to]) || pairOf([s.from, s.through]) : null);
    if (!pr) return null;
    for (const n of pr) if (!P[n]) missing.add(n);
    return pr.every((n) => P[n]) ? pr : null;
  };

  const segments = list(raw.segments ?? raw.sides).map((s) => ({ pr: ends(s), s })).filter((x) => x.pr);
  const lines = list(raw.lines).map((s) => ({ pr: ends(s), s })).filter((x) => x.pr);
  const rays = list(raw.rays).map((s) => ({ pr: ends(s), s })).filter((x) => x.pr);
  const polygons = list(raw.polygons ?? raw.polygon).map((p) => {
    const names = Array.isArray(p) ? p : Array.isArray(p?.points) ? p.points : typeof p === "string" ? p.match(/[A-Z][′']?/g) : null;
    if (!names || names.length < 3) return null;
    for (const n of names) if (!P[n]) missing.add(n);
    return names.every((n) => P[n]) ? { names, fill: typeof p === "object" && !Array.isArray(p) ? p.fill : null } : null;
  }).filter(Boolean);
  // A triangle given by its sides is drawn, sides and all.
  for (const t of [raw.triangle, ...list(raw.triangles)].filter((t) => t && typeof t === "object")) {
    const names = String(t.name ?? t.vertices ?? "ABC").match(/[A-Za-z][′']?/g) || [];
    if (names.length === 3 && names.every((n) => P[n]) && !polygons.some((p) => p.names.join() === names.join())) polygons.push({ names, fill: null, fromTriangle: t });
  }
  const circles = list(raw.circles).map((c) => ({ c: readCircle(c, P, named), s: c })).filter((x) => x.c);
  if (missing.size) return { error: `The figure uses points it never places: ${[...missing].slice(0, 4).join(", ")}.` };

  // Fit everything to the picture.
  const pts = [...Object.values(P), ...circles.flatMap(({ c }) => [[c.o[0] - c.r, c.o[1] - c.r], [c.o[0] + c.r, c.o[1] + c.r]])];
  let x0 = Math.min(...pts.map((p) => p[0]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  const size = Math.max(x1 - x0, y1 - y0) || 1;
  const pad = size * 0.14;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W0 = 600;
  const k = Math.min(W0 / (x1 - x0), 440 / (y1 - y0));
  const W = (x1 - x0) * k;
  const H = (y1 - y0) * k;
  const X = (p) => [(p[0] - x0) * k, H - (p[1] - y0) * k];
  const centre = mul(Object.values(P).reduce((s, p) => add(s, p), [0, 0]), 1 / Math.max(1, Object.keys(P).length));
  const out = [];
  const S = (w = 2, extra = "") => `stroke="${INK}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra}`;
  const dashOf = (s) => (s && typeof s === "object" && (s.dashed || /dash/.test(String(s.style)))) ? ` stroke-dasharray="7 5"` : "";
  const colourOf = (s) => (s && typeof s === "object" && typeof s.color === "string" && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : INK);
  const neighbours = Object.fromEntries(Object.keys(P).map((n) => [n, []]));
  const link = (a, b) => { neighbours[a]?.push(b); neighbours[b]?.push(a); };

  for (const { names, fill } of polygons) {
    const safeFill = typeof fill === "string" && /^#[0-9a-f]{3,8}$/i.test(fill) ? fill : "none";
    out.push(poly(names.map((n) => X(P[n])), `${S(2.2)} fill="${safeFill}" fill-opacity="0.18"`, true));
    names.forEach((n, i) => link(n, names[(i + 1) % names.length]));
  }
  for (const { c, s } of circles) {
    const [cx, cy] = X(c.o);
    out.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(c.r * k)}" ${S(2)}${dashOf(s)} stroke="${colourOf(s)}"/>`);
  }
  // A line through two points, across the whole picture.
  const across = (a, b, both = true) => {
    const d = unit(sub(b, a));
    const far = size * 3;
    return [both ? sub(a, mul(d, far)) : a, add(a, mul(d, far))];
  };
  const clipTo = ([a, b]) => {
    // Liang–Barsky against the picture's box.
    let t0 = 0;
    let t1 = 1;
    const d = sub(b, a);
    for (const [p, q] of [[-d[0], a[0] - x0], [d[0], x1 - a[0]], [-d[1], a[1] - y0], [d[1], y1 - a[1]]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    return t0 < t1 ? [add(a, mul(d, t0)), add(a, mul(d, t1))] : null;
  };
  for (const { pr, s } of lines) { const seg = clipTo(across(P[pr[0]], P[pr[1]])); if (seg) out.push(line(X(seg[0]), X(seg[1]), `${S(1.6)}${dashOf(s)}`)); link(pr[0], pr[1]); }
  for (const { pr, s } of rays) { const seg = clipTo(across(P[pr[0]], P[pr[1]], false)); if (seg) out.push(line(X(seg[0]), X(seg[1]), `${S(1.6)}${dashOf(s)}`)); link(pr[0], pr[1]); }
  const labels = [];
  for (const { pr, s } of segments) {
    const a = P[pr[0]];
    const b = P[pr[1]];
    out.push(line(X(a), X(b), `${S(2.2)}${dashOf(s)}`).replace(`stroke="${INK}"`, `stroke="${colourOf(s)}"`));
    link(pr[0], pr[1]);
    const label = s && typeof s === "object" ? s.label : null;
    if (label === true || typeof label === "string" || typeof label === "number") labels.push({ a, b, text: label === true ? `${fmt(dist(a, b), 1)} ${u}` : String(label) });
    const ticks = s && typeof s === "object" ? Math.min(3, Math.max(0, num(s.ticks) || 0)) : 0;
    if (ticks) {
      const m = X(mul(add(a, b), 0.5));
      const d = unit(sub(X(b), X(a)));
      const n = [-d[1], d[0]];
      for (let i = 0; i < ticks; i++) {
        const c = add(m, mul(d, (i - (ticks - 1) / 2) * 5));
        out.push(line(add(c, mul(n, 6)), sub(c, mul(n, 6)), S(1.6)));
      }
    }
  }
  // Side lengths of a triangle given by its sides.
  for (const { names, fromTriangle } of polygons) {
    if (!fromTriangle || fromTriangle.labels === false) continue;
    names.forEach((n, i) => {
      const m = names[(i + 1) % 3];
      const v = num(fromTriangle[n + m] ?? fromTriangle[m + n]);
      if (Number.isFinite(v) && !labels.some((l) => l.a === P[n] && l.b === P[m])) labels.push({ a: P[n], b: P[m], text: `${fmt(v, 2)} ${u}` });
    });
  }
  // A side's length beside its middle, outside the figure — moved along
  // the side if a point's name (a midpoint) is already there.
  const placed = Object.values(P).map(X);
  for (const l of labels) {
    const d = unit(sub(l.b, l.a));
    let n = [-d[1], d[0]];
    const m0 = mul(add(l.a, l.b), 0.5);
    if ((m0[0] - centre[0]) * n[0] + (m0[1] - centre[1]) * n[1] < 0) n = mul(n, -1);
    let q = null;
    for (const t of [0.5, 0.32, 0.68, 0.22, 0.78]) {
      const p = X(add(l.a, mul(sub(l.b, l.a), t)));
      const c = [p[0] + n[0] * 15, p[1] - n[1] * 15];
      q = q || c;
      if (placed.every((z) => Math.hypot(z[0] - c[0], z[1] - c[1]) > 26)) { q = c; break; }
    }
    out.push(text(q[0], q[1] + 4.5, l.text, `font-size="13.5" text-anchor="middle" fill="${INK}" paint-order="stroke" stroke="#fff" stroke-width="4"`));
  }

  // Angles: an arc (or a small square for 90°) and the size.
  const angleList = list(raw.angles).map((a) => {
    if (typeof a === "string") { const n = a.match(/[A-Z][′']?/g); return n?.length === 3 ? { from: n[0], at: n[1], to: n[2], label: true } : null; }
    if (a && typeof a === "object") {
      const between = Array.isArray(a.between) ? a.between : [a.from, a.to];
      return { at: a.at ?? a.vertex, from: between[0], to: between[1], label: a.label ?? true, marks: num(a.marks) || 1 };
    }
    return null;
  }).filter((a) => a && P[a.at] && P[a.from] && P[a.to]);
  // A triangle given by its angles shows them.
  for (const { names, fromTriangle } of polygons) {
    if (!fromTriangle) continue;
    names.forEach((n, i) => {
      const given = num(fromTriangle[`angle${n}`] ?? fromTriangle[`∠${n}`] ?? fromTriangle[n]);
      if (Number.isFinite(given) && !angleList.some((a) => a.at === n)) angleList.push({ at: n, from: names[(i + 2) % 3], to: names[(i + 1) % 3], label: true });
    });
  }
  const usedAt = {};
  for (const a of angleList) {
    const v = P[a.at];
    let d1 = unit(sub(P[a.from], v));
    let d2 = unit(sub(P[a.to], v));
    let a1 = Math.atan2(d1[1], d1[0]);
    let a2 = Math.atan2(d2[1], d2[0]);
    let sweep = a2 - a1;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < 0) { [d1, d2] = [d2, d1]; [a1, a2] = [a2, a1]; sweep = -sweep; }
    const deg = (sweep / RAD);
    const k2 = usedAt[a.at] = (usedAt[a.at] || 0) + 1;
    const rad = 20 + (k2 - 1) * 9;
    const [vx, vy] = X(v);
    if (Math.abs(deg - 90) < 0.5) {
      const s = 12;
      const p1 = [vx + d1[0] * s, vy - d1[1] * s];
      const p2 = [vx + (d1[0] + d2[0]) * s, vy - (d1[1] + d2[1]) * s];
      const p3 = [vx + d2[0] * s, vy - d2[1] * s];
      out.push(poly([p1, p2, p3], S(1.5)));
    } else {
      for (let m = 0; m < (a.marks || 1); m++) {
        const rr = rad + m * 4;
        const s1 = [vx + Math.cos(a1) * rr, vy - Math.sin(a1) * rr];
        const s2 = [vx + Math.cos(a2) * rr, vy - Math.sin(a2) * rr];
        out.push(`<path d="M${r2(s1[0])} ${r2(s1[1])}A${rr} ${rr} 0 0 0 ${r2(s2[0])} ${r2(s2[1])}" ${S(1.5)}/>`);
      }
    }
    if (a.label !== false) {
      const t = a.label === true || a.label == null ? `${fmt(deg, 1)}°` : String(a.label);
      const mid = a1 + sweep / 2;
      const lr = rad + 18;
      out.push(text(vx + Math.cos(mid) * lr, vy - Math.sin(mid) * lr + 4.5, t, `font-size="12.5" text-anchor="middle" fill="${INK}" paint-order="stroke" stroke="#fff" stroke-width="4"`));
    }
  }

  // Construction arcs (compass marks).
  for (const arc of list(raw.arcs)) {
    const o = typeof arc?.center === "string" ? P[arc.center] : null;
    const r = num(arc?.r ?? arc?.radius);
    if (!o || !(r > 0)) continue;
    const toward = typeof arc.around === "string" && P[arc.around] ? Math.atan2(P[arc.around][1] - o[1], P[arc.around][0] - o[0]) : num(arc.angle ?? 90) * RAD;
    const spread = (num(arc.spread) || 22) * RAD;
    const s1 = X(add(o, mul([Math.cos(toward - spread), Math.sin(toward - spread)], r)));
    const s2 = X(add(o, mul([Math.cos(toward + spread), Math.sin(toward + spread)], r)));
    out.push(`<path d="M${r2(s1[0])} ${r2(s1[1])}A${r2(r * k)} ${r2(r * k)} 0 0 0 ${r2(s2[0])} ${r2(s2[1])}" ${S(1.2)} stroke="#57534e"/>`);
  }

  // Points and their names, set away from the lines meeting there.
  const hidden = new Set(list(raw.hide));
  for (const [name, p] of Object.entries(P)) {
    if (hidden.has(name)) continue;
    const [x, y] = X(p);
    out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="3" fill="${INK}"/>`);
    let away = [0, 0];
    for (const n of neighbours[name]) away = add(away, unit(sub(P[n], p)));
    away = len(away) > 1e-6 ? mul(unit(away), -1) : unit(sub(p, centre));
    if (len(away) < 1e-6) away = [0.7, 0.7];
    out.push(text(x + away[0] * 15, y - away[1] * 15 + 5, name, `font-size="15" font-weight="700" font-style="italic" text-anchor="middle" fill="${INK}"`));
  }
  const drawn = sheet({ width: W, height: H, title: spec.title, body: out.join(""), caption: raw.caption ? clean(raw.caption, 200) : "" });
  return { title: spec.title || "Geometry figure", ...drawn };
}
