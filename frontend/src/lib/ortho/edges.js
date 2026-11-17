import { ACROSS, add, cross, dot, hiddenFrom, len, mul, norm, perpendiculars, sub } from "./solid.js";

// The edges of the solid, and how each view sees them. An edge is wherever
// two faces meet at an angle: every candidate line or curve (where two face
// surfaces cross) is probed along its length, and kept where the solid
// around it is neither empty, full nor a flat face. Round faces add their
// outline (silhouette) in each view. Then each piece is checked against the
// viewer: drawn continuous if nothing is in front of it, dashed if hidden.

const TWO_PI = Math.PI * 2;

// The views, as the viewer's direction from the object and the paper's
// right and up. The top view has the front of the object at the bottom; a
// side view has the face nearest the viewer's right hand on the right.
export const VIEWS = {
  front: { toViewer: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
  top: { toViewer: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  left: { toViewer: [-1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  right: { toViewer: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  iso: { toViewer: norm([1, 1, -1]), right: norm([1, 0, 1]), up: norm([-1, 2, 1]) },
};

// A straight line o + t·d (d a unit vector) or a curve at(θ), with where it
// lies inside the solid's bounds.
function lineCurve(o, d, range) {
  return { kind: "line", o, d, t0: range[0], t1: range[1], at: (t) => add(o, mul(d, t)), tangent: () => d };
}
function closedCurve(at) {
  const tangent = (t) => {
    const a = at(t - 1e-4);
    const b = at(t + 1e-4);
    return a && b ? norm(sub(b, a)) : null;
  };
  return { kind: "curve", t0: 0, t1: TWO_PI, closed: true, at, tangent };
}

const axisVec = (axis) => { const v = [0, 0, 0]; v[axis] = 1; return v; };

// The point on a cylinder's axis at position t along it.
function onAxis(cy, t) {
  const [j, k] = ACROSS[cy.axis];
  const p = [0, 0, 0];
  p[cy.axis] = t;
  p[j] = cy.center[0];
  p[k] = cy.center[1];
  return p;
}

function onCircle(cy, theta, t) {
  const [j, k] = ACROSS[cy.axis];
  const p = [0, 0, 0];
  p[cy.axis] = t;
  p[j] = cy.center[0] + cy.r * Math.cos(theta);
  p[k] = cy.center[1] + cy.r * Math.sin(theta);
  return p;
}

// Straight lines along a cylinder (its axis direction) through points of its
// cross-section circle.
function generators(solid, cy, thetas) {
  const out = [];
  for (const theta of thetas) {
    const o = onCircle(cy, theta, 0);
    const d = axisVec(cy.axis);
    const range = solid.clip(o, d);
    if (range) out.push(lineCurve(o, d, range));
  }
  return out;
}

// The angles where a line a·cosθ + b·sinθ = c meets the unit circle.
function circleAngles(a, b, c) {
  const rho = Math.hypot(a, b);
  if (rho < 1e-12 || Math.abs(c) > rho * (1 + 1e-9)) return [];
  const base = Math.atan2(b, a);
  const spread = Math.acos(Math.max(-1, Math.min(1, c / rho)));
  return spread < 1e-9 ? [base] : [base - spread, base + spread];
}

// Every place two face surfaces cross: plane–plane lines, plane–cylinder
// circles, ellipses and lines, and cylinder–cylinder curves.
function candidates(solid) {
  const out = [];
  const { planes, cylinders } = solid;
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i];
      const b = planes[j];
      const d = cross(a.n, b.n);
      const s = len(d);
      if (s < 1e-9) continue;
      const ab = dot(a.n, b.n);
      const det = 1 - ab * ab;
      const o = add(mul(a.n, (a.c - b.c * ab) / det), mul(b.n, (b.c - a.c * ab) / det));
      const dir = mul(d, 1 / s);
      const range = solid.clip(o, dir);
      if (range) out.push(lineCurve(o, dir, range));
    }
  }
  for (const cy of cylinders) {
    const [j, k] = ACROSS[cy.axis];
    for (const { n, c } of planes) {
      if (Math.abs(n[cy.axis]) > 1e-9) {
        // A circle (or an ellipse on a sloping face).
        out.push(closedCurve((theta) => {
          const pj = cy.center[0] + cy.r * Math.cos(theta);
          const pk = cy.center[1] + cy.r * Math.sin(theta);
          const p = [0, 0, 0];
          p[j] = pj;
          p[k] = pk;
          p[cy.axis] = (c - n[j] * pj - n[k] * pk) / n[cy.axis];
          return p;
        }));
      } else {
        // A face along the axis cuts the round face in straight lines.
        const rest = c - n[j] * cy.center[0] - n[k] * cy.center[1];
        out.push(...generators(solid, cy, circleAngles(n[j] * cy.r, n[k] * cy.r, rest)));
      }
    }
  }
  const { cones } = solid;
  const coaxial = (a, b) => a.axis === b.axis && Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) < 1e-9;
  const ring = (axis, center, r, t) => closedCurve((theta) => onCircle({ axis, center, r }, theta, t));
  for (const cone of cones) {
    const [j, k] = ACROSS[cone.axis];
    for (const { n, c } of planes) {
      // Along each line of the cone, where the face's plane crosses it.
      out.push(closedCurve((theta) => {
        const cs = n[j] * Math.cos(theta) + n[k] * Math.sin(theta);
        const den = n[cone.axis] + cone.b * cs;
        if (Math.abs(den) < 1e-9) return null;
        const t = (c - n[j] * cone.center[0] - n[k] * cone.center[1] - cone.a * cs) / den;
        const r = cone.a + cone.b * t;
        if (r < 0) return null;
        return onCircle({ axis: cone.axis, center: cone.center, r }, theta, t);
      }));
    }
    // A countersink meets its hole (or another cone) in a circle.
    for (const cy of cylinders) {
      if (!coaxial(cone, cy) || Math.abs(cone.b) < 1e-12) continue;
      out.push(ring(cone.axis, cone.center, cy.r, (cy.r - cone.a) / cone.b));
    }
    for (const other of cones) {
      if (other === cone || !coaxial(cone, other) || Math.abs(cone.b - other.b) < 1e-12) continue;
      const t = (other.a - cone.a) / (cone.b - other.b);
      const r = cone.a + cone.b * t;
      if (r > 1e-9) out.push(ring(cone.axis, cone.center, r, t));
    }
  }
  for (let i = 0; i < cylinders.length; i++) {
    for (let m = i + 1; m < cylinders.length; m++) {
      const A = cylinders[i];
      const B = cylinders[m];
      if (A.axis === B.axis) {
        // Side by side: where their circles cross.
        const dj = B.center[0] - A.center[0];
        const dk = B.center[1] - A.center[1];
        const dist = Math.hypot(dj, dk);
        if (dist < 1e-9) continue;
        const c = (A.r * A.r - B.r * B.r + dist * dist) / (2 * A.r);
        out.push(...generators(solid, A, circleAngles(dj, dk, c)));
        continue;
      }
      // At right angles: for each point round A, B's equation fixes the
      // position along A's axis (two branches).
      const [bj] = ACROSS[B.axis];
      const other = ACROSS[A.axis].find((ax) => ax !== B.axis); // A's cross coordinate that B also uses
      const bOther = other === bj ? B.center[0] : B.center[1];
      const bAlong = A.axis === bj ? B.center[0] : B.center[1];
      for (const sign of [1, -1]) {
        out.push(closedCurve((theta) => {
          const p = onCircle(A, theta, 0);
          const off = p[other] - bOther;
          const h = B.r * B.r - off * off;
          if (h < 0) return null;
          p[A.axis] = bAlong + sign * Math.sqrt(h);
          return p;
        }));
      }
    }
  }
  return out;
}

// How the solid fills a ring of radius rho round p, across the curve: how
// many of its points are inside, and how often it goes in and out.
function ring(solid, p, a, b, rho) {
  const N = 48;
  let count = 0;
  let flips = 0;
  let first = null;
  let prev = null;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.37) / N) * TWO_PI;
    const s = solid.inside(add(p, add(mul(a, rho * Math.cos(th)), mul(b, rho * Math.sin(th)))));
    if (s) count++;
    if (prev !== null && s !== prev) flips++;
    if (first === null) first = s;
    prev = s;
  }
  if (prev !== first) flips++;
  const crease = count > 0 && count < N && !(flips === 2 && Math.abs(count - N / 2) <= 1);
  return { count, crease };
}

// Whether the faces around p meet at an angle there (an edge) rather than
// being one flat or gently curved face. Felt with two rings: on a true edge
// both find the same corner, while a point just off a face (where a line
// pierces it at a slant) looks like a corner to the wide ring only.
function isCrease(solid, p, tangent, scale = 1) {
  if (!p || !tangent) return false;
  const [a, b] = perpendiculars(tangent);
  const near = ring(solid, p, a, b, solid.eps * 0.25 * scale);
  if (!near.crease) return false;
  const wide = ring(solid, p, a, b, solid.eps * scale);
  return wide.crease && Math.abs(wide.count - near.count) <= 2;
}

// The stretches of [t0, t1] where test(t) holds, ends found by halving.
function runsWhere(curve, test, step) {
  const span = curve.t1 - curve.t0;
  const n = Math.max(8, Math.ceil(span / step));
  const at = (i) => curve.t0 + (span * i) / n;
  const flags = [];
  for (let i = 0; i <= n; i++) flags.push(test(at(i)));
  const edgeOf = (lo, hi, loFlag) => {
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      if (test(mid) === loFlag) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const runs = [];
  let start = flags[0] ? curve.t0 : null;
  for (let i = 1; i <= n; i++) {
    if (flags[i] === flags[i - 1]) continue;
    const t = edgeOf(at(i - 1), at(i), flags[i - 1]);
    if (flags[i]) start = t;
    else { runs.push([start, t]); start = null; }
  }
  if (start !== null) runs.push([start, curve.t1]);
  // A closed curve's run through θ = 0 is one run.
  if (curve.closed && runs.length > 1 && runs[0][0] === curve.t0 && runs[runs.length - 1][1] === curve.t1) {
    const last = runs.pop();
    runs[0] = [last[0] - TWO_PI, runs[0][1]];
  }
  return runs;
}

// A straight edge ends exactly where its line meets another face: each end
// moves to the nearest such crossing. Near a sharp corner (a thin rib's tip)
// the probes stop a little short, so a crossing a bit further on is taken
// if a much finer probe still finds the edge on the way to it.
function snapLineEnds(solid, curve, runs, test) {
  const stops = solid.crossings(curve.o, curve.d);
  const end = (t, outward) => {
    const near = stops.filter((s) => Math.abs(s - t) < solid.eps * 6).sort((x, y) => Math.abs(x - t) - Math.abs(y - t));
    for (const s of near) {
      if (Math.abs(s - t) < solid.eps * 3) return s;
      if ((s - t) * outward > 0 && test && [0.25, 0.5, 0.75].every((f) => test(t + (s - t) * f, 0.12))) return s;
    }
    return t;
  };
  return runs.map(([a, b]) => [end(a, -1), end(b, 1)]).filter(([a, b]) => b - a > solid.eps * 0.5);
}

/** Every edge where faces meet at an angle, the same from every side. */
export function findEdges(solid) {
  const step = solid.size / 260;
  const edges = [];
  for (const curve of candidates(solid)) {
    const test = (t, scale = 1) => isCrease(solid, curve.at(t), curve.tangent(t), scale);
    if (curve.kind === "line") {
      const runs = snapLineEnds(solid, curve, runsWhere(curve, (t) => test(t), step), test);
      if (runs.length) edges.push({ curve, runs });
    } else {
      const runs = runsWhere(curve, test, TWO_PI / 180);
      if (runs.length) edges.push({ curve, runs });
    }
  }
  return edges;
}

// A round face's outline seen from `toViewer`: the two lines along it where
// it turns away, kept where that face is really there.
function silhouettes(solid, toViewer) {
  const out = [];
  for (const cy of solid.cylinders) {
    const [j, k] = ACROSS[cy.axis];
    if (Math.hypot(toViewer[j], toViewer[k]) < 1e-9) continue;
    const theta = Math.atan2(-toViewer[j], toViewer[k]);
    for (const curve of generators(solid, cy, [theta, theta + Math.PI])) {
      const radial = norm(sub(curve.o, onAxis(cy, curve.o[cy.axis])));
      const test = (t) => onRoundFace(solid, curve.at(t), radial);
      const runs = snapLineEnds(solid, curve, runsWhere(curve, test, solid.size / 260));
      if (runs.length) out.push({ curve, runs, silhouette: true, cylinder: cy });
    }
  }
  for (const cone of solid.cones) {
    const [j, k] = ACROSS[cone.axis];
    // Where the cone's surface turns away: its normal (out from the axis,
    // tipped by the slope) square to the line of sight.
    for (const theta of circleAngles(toViewer[j], toViewer[k], cone.b * toViewer[cone.axis])) {
      const radial = [0, 0, 0];
      radial[j] = Math.cos(theta);
      radial[k] = Math.sin(theta);
      const normal = norm(sub(radial, mul(axisVec(cone.axis), cone.b)));
      const t0 = cone.from;
      const o = onCircle({ axis: cone.axis, center: cone.center, r: cone.a + cone.b * t0 }, theta, t0);
      const d = norm(add(axisVec(cone.axis), mul(radial, cone.b)));
      const range = solid.clip(o, d);
      if (!range) continue;
      const curve = lineCurve(o, d, range);
      const test = (t) => onRoundFace(solid, curve.at(t), normal);
      const runs = snapLineEnds(solid, curve, runsWhere(curve, test, solid.size / 260));
      if (runs.length) out.push({ curve, runs, silhouette: true });
    }
  }
  return out;
}

// Whether p, on a round face's surface, is really on that face: the solid
// changes across it, the same at two probe distances (so a face that only
// passes nearby doesn't count).
function onRoundFace(solid, p, radial) {
  const far = mul(radial, solid.eps);
  const close = mul(radial, solid.eps * 0.25);
  const out = solid.inside(add(p, far));
  const inn = solid.inside(sub(p, far));
  return out !== inn && out === solid.inside(add(p, close)) && inn === solid.inside(sub(p, close));
}

const project = (view, p) => [dot(p, view.right), dot(p, view.up)];

// How an edge's stretch looks in a view: pieces of it, each visible or hidden.
function viewPieces(solid, view, edge, across) {
  const pieces = [];
  const seen = (t) => {
    const p = edge.curve.at(t);
    return !p || !hiddenFrom(solid, p, view.toViewer, across);
  };
  for (const [a, b] of edge.runs) {
    const curve = { ...edge.curve, t0: a, t1: b, closed: false };
    if (edge.curve.kind === "line") {
      const ta = project(view, curve.at(a));
      const tb = project(view, curve.at(b));
      if (Math.hypot(tb[0] - ta[0], tb[1] - ta[1]) < solid.eps * 0.5) continue; // end-on: a point
      const visible = runsWhere(curve, seen, solid.size / 200);
      let at = a;
      for (const [s, e] of visible) {
        if (s > at + 1e-9) pieces.push({ type: "seg", a: project(view, curve.at(at)), b: project(view, curve.at(s)), hidden: true });
        pieces.push({ type: "seg", a: project(view, curve.at(s)), b: project(view, curve.at(e)), hidden: false });
        at = e;
      }
      if (b > at + 1e-9) pieces.push({ type: "seg", a: project(view, curve.at(at)), b: project(view, curve.at(b)), hidden: true });
    } else {
      const steps = Math.max(12, Math.ceil(((b - a) / TWO_PI) * 180));
      const fine = { ...curve, closed: false };
      const vis = runsWhere(fine, seen, (b - a) / steps);
      const sample = (s, e, hidden) => {
        const n = Math.max(2, Math.ceil(((e - s) / TWO_PI) * 180));
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const p = curve.at(s + ((e - s) * i) / n);
          if (p) pts.push(project(view, p));
        }
        if (pts.length > 1) pieces.push({ type: "poly", pts, hidden });
      };
      let at = a;
      for (const [s, e] of vis) {
        if (s > at + 1e-9) sample(at, s, true);
        sample(s, e, false);
        at = e;
      }
      if (b > at + 1e-9) sample(at, b, true);
    }
  }
  return pieces;
}

// A curve seen edge-on is a straight line; draw it as one.
function straighten(piece, tol) {
  if (piece.type !== "poly") return piece;
  const { pts } = piece;
  let a = pts[0];
  let b = pts[0];
  let far = 0;
  for (const p of pts) for (const q of [pts[0], pts[pts.length - 1]]) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > far) { far = d; a = q; b = p; }
  }
  if (far < tol) return null;
  const ux = (b[0] - a[0]) / far;
  const uy = (b[1] - a[1]) / far;
  let lo = 0;
  let hi = 0;
  for (const p of pts) {
    if (Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) > tol) return piece;
    const s = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return { type: "seg", a: [a[0] + ux * lo, a[1] + uy * lo], b: [a[0] + ux * hi, a[1] + uy * hi], hidden: piece.hidden };
}

// Straight pieces grouped by the line they lie on, as stretches along it:
// overlapping visible pieces become one, hidden ones lose whatever a visible
// line already covers (a visible line wins) and repeat only once.
function tidyLines(segs, tol) {
  const groups = [];
  for (const s of segs) {
    let dx = s.b[0] - s.a[0];
    let dy = s.b[1] - s.a[1];
    const l = Math.hypot(dx, dy);
    if (l < tol) continue;
    dx /= l; dy /= l;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const offset = -dy * s.a[0] + dx * s.a[1];
    let g = groups.find((q) => Math.abs(q.dx * dy - q.dy * dx) < 1e-6 && Math.abs(q.offset - offset) < tol);
    if (!g) { g = { dx, dy, offset, visible: [], hidden: [] }; groups.push(g); }
    const p = [s.a[0] * g.dx + s.a[1] * g.dy, s.b[0] * g.dx + s.b[1] * g.dy].sort((x, y) => x - y);
    (s.hidden ? g.hidden : g.visible).push(p);
  }
  const merge = (list) => {
    const sorted = list.slice().sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + tol) last[1] = Math.max(last[1], r[1]);
      else out.push([...r]);
    }
    return out;
  };
  const minus = (list, cover) => {
    let out = list;
    for (const [c0, c1] of cover) {
      const next = [];
      for (const [a, b] of out) {
        if (c1 <= a + tol || c0 >= b - tol) { next.push([a, b]); continue; }
        if (c0 > a + tol) next.push([a, c0]);
        if (c1 < b - tol) next.push([c1, b]);
      }
      out = next;
    }
    return out;
  };
  const out = [];
  for (const g of groups) {
    const point = (s) => [g.dx * s - g.dy * g.offset, g.dy * s + g.dx * g.offset];
    const visible = merge(g.visible);
    const hidden = minus(merge(g.hidden), visible).filter(([a, b]) => b - a > tol * 2);
    for (const [a, b] of visible) out.push({ type: "seg", a: point(a), b: point(b), hidden: false });
    for (const [a, b] of hidden) out.push({ type: "seg", a: point(a), b: point(b), hidden: true });
  }
  return out;
}

function nearPolyline(p, pts, tol) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    if (Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)) < tol) return true;
  }
  return false;
}

// Curved pieces: one copy of each, and hidden stretches a visible curve
// already covers dropped.
function tidyCurves(polys, tol) {
  const kept = [];
  const ordered = [...polys.filter((p) => !p.hidden), ...polys.filter((p) => p.hidden)];
  for (const poly of ordered) {
    const covered = (pt) => kept.some((k) => (poly.hidden || !k.hidden) && nearPolyline(pt, k.pts, tol));
    let run = [];
    const flush = () => { if (run.length > 1) kept.push({ type: "poly", pts: run, hidden: poly.hidden }); run = []; };
    for (const pt of poly.pts) {
      if (covered(pt)) flush();
      else run.push(pt);
    }
    flush();
  }
  return kept;
}

/**
 * What a view shows of the solid: `pieces` (2D lines and curves, visible or
 * hidden, in the view's own millimetres), and the round faces in it (for
 * centre lines and Ø dimensions).
 */
export function drawView(solid, edges, name) {
  const view = VIEWS[name];
  const across = [view.right, view.up];
  const all = [...edges, ...silhouettes(solid, view.toViewer)];
  const tol = Math.max(1e-4, solid.size * 1e-4);
  const raw = [];
  for (const edge of all) raw.push(...viewPieces(solid, view, edge, across));
  const straight = raw.map((p) => straighten(p, solid.size * 5e-4)).filter(Boolean);
  const pieces = [
    ...tidyLines(straight.filter((p) => p.type === "seg"), tol * 10),
    ...tidyCurves(straight.filter((p) => p.type === "poly"), Math.max(0.01, solid.size * 2e-4)),
  ];
  return { name, view, pieces, project: (p) => project(view, p) };
}

/**
 * Each round face that is really part of the solid, with how far it runs
 * along its axis and whether it is a whole circle (Ø) or an arc (R).
 */
export function roundFaces(solid) {
  const out = [];
  const seen = new Set();
  for (const cy of solid.cylinders) {
    const id = `${cy.axis}|${cy.center.map((v) => v.toFixed(4)).join(",")}|${cy.r.toFixed(4)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const range = solid.clip(onCircle(cy, 0, 0), axisVec(cy.axis), 0);
    if (!range) continue;
    let lo = Infinity;
    let hi = -Infinity;
    const angles = 72;
    const onFace = new Array(angles).fill(false);
    const along = 96;
    let hole = 0;
    let boss = 0;
    for (let i = 0; i < angles; i++) {
      const th = ((i + 0.5) / angles) * TWO_PI;
      const at = (s) => range[0] + ((range[1] - range[0]) * s) / along;
      const flags = [];
      for (let s = 0; s <= along; s++) {
        const p = onCircle(cy, th, at(s));
        flags.push(onRoundFace(solid, p, norm(sub(p, onAxis(cy, at(s))))));
      }
      // A lone hit is another face passing by chance; a face runs on.
      for (let s = 0; s <= along; s++) {
        if (!flags[s] || !(flags[s - 1] || flags[s + 1])) continue;
        const t = at(s);
        const p = onCircle(cy, th, t);
        onFace[i] = true;
        if (solid.inside(add(p, mul(norm(sub(p, onAxis(cy, t))), solid.eps)))) hole++; else boss++;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    // Its ends are where it meets a face across it.
    const step = (range[1] - range[0]) / along;
    const stops = solid.crossings(onAxis(cy, 0), axisVec(cy.axis));
    const snap = (t, dir) => stops.filter((s) => (s - t) * dir >= -1e-9 && Math.abs(s - t) <= step + 1e-9).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0] ?? t;
    lo = snap(lo, -1);
    hi = snap(hi, 1);
    const count = onFace.filter(Boolean).length;
    if (!count) continue;
    // The arc's longest stretch, for an R dimension's arrow.
    let bestStart = 0;
    let bestLen = 0;
    for (let i = 0; i < angles; i++) {
      if (!onFace[i] || onFace[(i + angles - 1) % angles]) continue;
      let n = 0;
      while (n < angles && onFace[(i + n) % angles]) n++;
      if (n > bestLen) { bestLen = n; bestStart = i; }
    }
    out.push({
      ...cy,
      from: lo,
      to: hi,
      whole: count >= angles - 1,
      hole: hole >= boss,
      arc: count >= angles - 1 ? null : [(bestStart / angles) * TWO_PI, ((bestStart + bestLen) / angles) * TWO_PI],
    });
  }
  // Cones (and countersinks) get centre lines too, across their widest end.
  for (const cone of solid.cones) {
    const from = Math.max(cone.from, solid.min[cone.axis]);
    const to = Math.min(cone.to, solid.max[cone.axis]);
    if (to <= from) continue;
    const r = Math.max(cone.a + cone.b * from, cone.a + cone.b * to);
    const twin = out.find((rf) => rf.axis === cone.axis && Math.hypot(rf.center[0] - cone.center[0], rf.center[1] - cone.center[1]) < 1e-9);
    if (twin) { twin.from = Math.min(twin.from, from); twin.to = Math.max(twin.to, to); continue; }
    out.push({ axis: cone.axis, center: cone.center, r, from, to, whole: true, hole: false, cone: true, arc: null });
  }
  return out;
}
