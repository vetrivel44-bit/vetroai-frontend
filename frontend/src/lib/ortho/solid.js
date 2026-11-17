// The solid an ```ortho block describes, built from boxes, cylinders, cones,
// pyramids and extruded profiles ("prisms") added and cut in order — enough for the
// machine blocks, brackets and bearings of an engineering drawing course.
// Everything here is plain maths, so it runs (and is tested) without a browser.
//
// Coordinates are millimetres: x left → right as seen in the front view,
// y bottom → top, z from the front face (0) to the back.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// The two coordinates across an axis, in x-y-z order: across x are y and z.
export const ACROSS = [[1, 2], [0, 2], [0, 1]];

// Two unit vectors at right angles to `d` and to each other.
export function perpendiculars(d) {
  const n = norm(d);
  const helper = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : Math.abs(n[1]) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const a = norm(cross(n, helper));
  return [a, cross(n, a)];
}

function inPolygon(a, b, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ai, bi] = pts[i];
    const [aj, bj] = pts[j];
    if ((bi > b) !== (bj > b) && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

// Whether a part holds a point (its surface included).
function holds(part, p) {
  const { min, max } = part.bounds;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) return false;
  if (part.kind === "box") return true;
  const [j, k] = ACROSS[part.axis];
  if (part.kind === "cylinder" || part.kind === "cone") {
    const dj = p[j] - part.center[0];
    const dk = p[k] - part.center[1];
    const r = part.kind === "cone" ? coneRadius(part, p[part.axis]) : part.r;
    return dj * dj + dk * dk <= r * r;
  }
  if (part.kind === "pyramid") {
    // Its section shrinks toward the apex: scale the point back to the base.
    const f = 1 - ((p[part.axis] - part.from) / (part.to - part.from)) * (1 - part.top);
    if (f <= 1e-12) return Math.hypot(p[j] - part.apex[0], p[k] - part.apex[1]) < 1e-9;
    return inPolygon(part.apex[0] + (p[j] - part.apex[0]) / f, part.apex[1] + (p[k] - part.apex[1]) / f, part.points);
  }
  return inPolygon(p[j], p[k], part.points);
}

// A cone's radius at position t along its axis (r1 at `from`, r2 at `to`).
export const coneRadius = (cone, t) => cone.r1 + ((cone.r2 - cone.r1) * (t - cone.from)) / (cone.to - cone.from);

function boundsOf(part) {
  if (part.kind === "box") return { min: part.min, max: part.max };
  const [j, k] = ACROSS[part.axis];
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  min[part.axis] = part.from;
  max[part.axis] = part.to;
  if (part.kind === "cylinder" || part.kind === "cone") {
    const r = part.kind === "cone" ? Math.max(part.r1, part.r2) : part.r;
    min[j] = part.center[0] - r; max[j] = part.center[0] + r;
    min[k] = part.center[1] - r; max[k] = part.center[1] + r;
  } else {
    const pts = part.kind === "pyramid" ? [...part.points, part.apex] : part.points;
    min[j] = Math.min(...pts.map((q) => q[0])); max[j] = Math.max(...pts.map((q) => q[0]));
    min[k] = Math.min(...pts.map((q) => q[1])); max[k] = Math.max(...pts.map((q) => q[1]));
  }
  return { min, max };
}

const axisNormal = (axis) => { const n = [0, 0, 0]; n[axis] = 1; return n; };

// Every flat face's plane and every round face's cylinder, each once.
function surfacesOf(parts) {
  const planes = new Map();
  const cylinders = new Map();
  const cones = new Map();
  const key = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1e6) / 1e6);
  const plane = (n, c) => {
    let nn = norm(n);
    let cc = c / (len(n) || 1);
    const lead = nn.find((v) => Math.abs(v) > 1e-9);
    if (lead < 0) { nn = mul(nn, -1); cc = -cc; }
    const id = `${nn.map(key).join(",")}|${key(cc)}`;
    if (!planes.has(id)) planes.set(id, { n: nn, c: cc });
  };
  for (const part of parts) {
    if (part.kind === "box") {
      for (let a = 0; a < 3; a++) { plane(axisNormal(a), part.min[a]); plane(axisNormal(a), part.max[a]); }
      continue;
    }
    plane(axisNormal(part.axis), part.from);
    plane(axisNormal(part.axis), part.to);
    const [j, k] = ACROSS[part.axis];
    if (part.kind === "cylinder") {
      const id = `${part.axis}|${key(part.center[0])}|${key(part.center[1])}|${key(part.r)}`;
      if (!cylinders.has(id)) cylinders.set(id, { axis: part.axis, center: part.center, r: part.r });
      continue;
    }
    if (part.kind === "cone") {
      // Kept as radius = a + b·t along the axis, the same cone however it was given.
      const b = (part.r2 - part.r1) / (part.to - part.from);
      const a = part.r1 - b * part.from;
      const id = `${part.axis}|${key(part.center[0])}|${key(part.center[1])}|${key(a)}|${key(b)}`;
      if (!cones.has(id)) cones.set(id, { axis: part.axis, center: part.center, a, b, from: part.from, to: part.to });
      continue;
    }
    if (part.kind === "pyramid") {
      // Each side face: through a base edge and the same edge at the top.
      const at = (q, f) => {
        const p = [0, 0, 0];
        p[part.axis] = part.from + f * (part.to - part.from);
        const s = 1 - f * (1 - part.top);
        p[j] = part.apex[0] + (q[0] - part.apex[0]) * s;
        p[k] = part.apex[1] + (q[1] - part.apex[1]) * s;
        return p;
      };
      part.points.forEach((q, i) => {
        const next = part.points[(i + 1) % part.points.length];
        const a = at(q, 0);
        const n = cross(sub(at(next, 0), a), sub(at(q, 0.5), a));
        if (len(n) > 1e-12) plane(n, dot(n, a));
      });
      continue;
    }
    part.points.forEach((q, i) => {
      const next = part.points[(i + 1) % part.points.length];
      const n = [0, 0, 0];
      n[j] = next[1] - q[1];
      n[k] = -(next[0] - q[0]);
      if (Math.hypot(n[j], n[k]) < 1e-9) return;
      const p = [0, 0, 0];
      p[j] = q[0];
      p[k] = q[1];
      plane(n, dot(n, p));
    });
  }
  return { planes: [...planes.values()], cylinders: [...cylinders.values()], cones: [...cones.values()] };
}

/**
 * The solid of a checked spec (spec.js): `inside(p)`, its bounds and size,
 * its faces' surfaces, and `crossings(o, d)` — where a line o + t·d passes
 * through any of those surfaces, for finding where edges end and whether
 * anything stands between an edge and the viewer.
 */
export function buildSolid(parts) {
  const list = parts.map((part) => ({ ...part, bounds: boundsOf(part) }));
  const inside = (p) => {
    let solid = false;
    for (const part of list) if (holds(part, p)) solid = part.op === "add";
    return solid;
  };
  const added = list.filter((p) => p.op === "add");
  const min = [0, 1, 2].map((a) => Math.min(...added.map((p) => p.bounds.min[a])));
  const max = [0, 1, 2].map((a) => Math.max(...added.map((p) => p.bounds.max[a])));
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // The smallest feature, so the probes that feel for edges are finer than it.
  const smallest = Math.min(...list.map((p) => {
    const b = p.bounds;
    const spans = [0, 1, 2].map((a) => b.max[a] - b.min[a]).filter((v) => v > 1e-6);
    if (p.kind === "cylinder") spans.push(p.r);
    if (p.kind === "cone") spans.push(Math.max(p.r1, p.r2));
    return Math.min(...spans);
  }));
  const eps = Math.max(1e-3, Math.min(size * 0.0015, smallest * 0.08));
  const { planes, cylinders, cones } = surfacesOf(list);

  function crossings(o, d) {
    const out = [];
    for (const { n, c } of planes) {
      const nd = dot(n, d);
      if (Math.abs(nd) > 1e-12) out.push((c - dot(n, o)) / nd);
    }
    for (const cy of cylinders) {
      const [j, k] = ACROSS[cy.axis];
      const qj = o[j] - cy.center[0];
      const qk = o[k] - cy.center[1];
      const a = d[j] * d[j] + d[k] * d[k];
      if (a < 1e-12) continue;
      const b = 2 * (qj * d[j] + qk * d[k]);
      const cc = qj * qj + qk * qk - cy.r * cy.r;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      out.push((-b - s) / (2 * a), (-b + s) / (2 * a));
    }
    for (const cone of cones) {
      // |across(o + t·d) − centre| = a + b·(o + t·d)[axis]
      const [j, k] = ACROSS[cone.axis];
      const qj = o[j] - cone.center[0];
      const qk = o[k] - cone.center[1];
      const A = cone.a + cone.b * o[cone.axis];
      const B = cone.b * d[cone.axis];
      const qa = d[j] * d[j] + d[k] * d[k] - B * B;
      const qb = 2 * (qj * d[j] + qk * d[k] - A * B);
      const qc = qj * qj + qk * qk - A * A;
      if (Math.abs(qa) < 1e-12) {
        if (Math.abs(qb) > 1e-12) out.push(-qc / qb);
        continue;
      }
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      out.push((-qb - s) / (2 * qa), (-qb + s) / (2 * qa));
    }
    return out.sort((x, y) => x - y);
  }

  // Where the line o + t·d is inside the solid's (padded) bounds.
  function clip(o, d, pad = size * 0.02) {
    let lo = -Infinity;
    let hi = Infinity;
    for (let a = 0; a < 3; a++) {
      const from = min[a] - pad;
      const to = max[a] + pad;
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < from || o[a] > to) return null;
        continue;
      }
      let t0 = (from - o[a]) / d[a];
      let t1 = (to - o[a]) / d[a];
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0);
      hi = Math.min(hi, t1);
    }
    return hi > lo ? [lo, hi] : null;
  }

  return { parts: list, inside, min, max, size, eps, planes, cylinders, cones, crossings, clip };
}

/**
 * Whether anything solid stands between point p and a viewer far off in
 * direction `toViewer`. A ray that only runs along a face (the top of a base
 * seen from the front) hides nothing; one through material does.
 */
export function hiddenFrom(solid, p, toViewer, across) {
  const ts = solid.crossings(p, toViewer).filter((t) => t > 1e-7);
  const far = solid.clip(p, toViewer, solid.size * 0.05);
  if (!far || far[1] <= 0) return false;
  ts.push(far[1]);
  const tau = solid.size * 1e-6;
  const [u, v] = across;
  const probes = [u, mul(u, -1), v, mul(v, -1), norm(add(u, v)), norm(sub(u, v)), norm(sub(v, u)), mul(norm(add(u, v)), -1)];
  let prev = 0;
  for (const t of ts) {
    if (t > far[1] + 1e-9) break;
    if (t - prev > 1e-6) {
      const m = add(p, mul(toViewer, (prev + t) / 2));
      if (solid.inside(m) && probes.every((q) => solid.inside(add(m, mul(q, tau))))) return true;
    }
    prev = Math.max(prev, t);
  }
  return false;
}
