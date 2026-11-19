import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Staunton-style chess pieces built procedurally (no model download needed).
//
// Each round piece is a LatheGeometry turned from a hand-built profile made of
// straight runs, quadratic curves and half-round beads, so the silhouette has
// the crisp collars, coves and beads of a real turned-wood set. Details that
// aren't round (rook merlons, queen's coronet balls, king's cross, knight's
// head) are separate geometries MERGED into one BufferGeometry per piece type,
// so every piece on the board is exactly one mesh / one draw call, and the six
// geometries are built once and shared by all 32 pieces.
//
// Units: 1 = one board square. Base diameters are 62–76 % of a square and the
// heights follow real-set proportions:
//   K 1.30 > Q 1.09 > B 0.97 > N 0.88 > R 0.74 > P 0.64

const RADIAL_SEGMENTS = 48;

// ── profile builder ────────────────────────────────────────────────────────
class Profile {
  constructor() { this.pts = []; }

  get last() { return this.pts[this.pts.length - 1]; }

  line(r, y) { this.pts.push(new THREE.Vector2(r, y)); return this; }

  // Quadratic Bézier from the current point through control (cr, cy) to (r, y).
  quad(cr, cy, r, y, n = 10) {
    const { x: r0, y: y0 } = this.last;
    for (let i = 1; i <= n; i += 1) {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      this.pts.push(new THREE.Vector2(a * r0 + b * cr + c * r, a * y0 + b * cy + c * y));
    }
    return this;
  }

  // Half-round bead bulging outward, from the current point straight up by 2·rad.
  bead(rad, n = 10) {
    const { x: cr, y } = this.last;
    const cy = y + rad;
    for (let i = 1; i <= n; i += 1) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      this.pts.push(new THREE.Vector2(cr + Math.cos(a) * rad * 0.9, cy + Math.sin(a) * rad));
    }
    return this;
  }

  // Sphere of radius `rad` centred on the axis at height cy, from where the
  // current radius meets it, up to the pole.
  ball(cy, rad, n = 16) {
    const r0 = Math.min(this.last.x, rad * 0.98);
    const a0 = -Math.acos(r0 / rad);
    for (let i = 0; i <= n; i += 1) {
      const a = a0 + (i / n) * (Math.PI / 2 - a0);
      this.pts.push(new THREE.Vector2(Math.max(Math.cos(a) * rad, 0), cy + Math.sin(a) * rad));
    }
    return this;
  }

  // Shared turned foot: flat bottom, rounded edge, a bead, then a cove that
  // sweeps into the stem. Ends at (stemR, 0.15).
  base(R, stemR) {
    return this
      .line(0, 0)
      .line(R - 0.012, 0)
      .quad(R, 0, R, 0.014, 4)
      .line(R, 0.032)
      .quad(R, 0.048, R - 0.03, 0.052, 6)
      .line(R - 0.04, 0.056)
      .bead(0.02, 8)
      .line(R - 0.05, 0.098)
      .quad(stemR, 0.104, stemR, 0.15, 10);
  }

  // A collar: step out to rc, half-round bead of height `thick`, step in to rIn.
  collar(rc, thick, rIn) {
    const y = this.last.y;
    this.line(rc, y + 0.004).bead(thick / 2, 8);
    return this.line(rIn, this.last.y + 0.004);
  }

  build() { return new THREE.LatheGeometry(this.pts, RADIAL_SEGMENTS); }
}

// ── per-piece bodies ───────────────────────────────────────────────────────

function pawnBody() {
  return new Profile()
    .base(0.31, 0.175)
    .quad(0.12, 0.24, 0.1, 0.33)
    .collar(0.175, 0.034, 0.08)
    .ball(0.5, 0.135)
    .build();
}

function rookBody() {
  const body = new Profile()
    .base(0.36, 0.215)
    .quad(0.2, 0.3, 0.215, 0.47)
    .collar(0.25, 0.03, 0.235)
    .line(0.275, 0.53)
    .line(0.285, 0.655)
    .quad(0.29, 0.66, 0.282, 0.664, 3)
    .line(0.215, 0.664)
    .line(0.21, 0.63)
    .line(0, 0.63)
    .build();

  // Crenellations: six chunky ring-sector merlons standing on the rim.
  const span = (Math.PI * 2) / 6;
  const half = span * 0.3;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.278, -half, half, false);
  shape.absarc(0, 0, 0.218, half, -half, true);
  const merlon = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8,
  });
  merlon.rotateX(-Math.PI / 2);
  merlon.translate(0, 0.664, 0);
  const parts = [body];
  for (let i = 0; i < 6; i += 1) {
    const m = merlon.clone();
    m.rotateY(i * span + span / 2);
    parts.push(m);
  }
  merlon.dispose();
  return parts;
}

function bishopBody() {
  return new Profile()
    .base(0.35, 0.2)
    .quad(0.13, 0.3, 0.1, 0.46)
    .collar(0.175, 0.03, 0.13)
    .collar(0.15, 0.018, 0.085)
    .quad(0.2, 0.6, 0.175, 0.7)
    .quad(0.15, 0.8, 0.035, 0.86)
    .line(0.03, 0.87)
    .ball(0.92, 0.05)
    .build();
}

function queenBody() {
  const body = new Profile()
    .base(0.37, 0.21)
    .quad(0.13, 0.33, 0.11, 0.55)
    .collar(0.19, 0.032, 0.15)
    .collar(0.165, 0.02, 0.1)
    .quad(0.15, 0.74, 0.24, 0.86)
    .line(0.245, 0.885)
    .line(0.2, 0.89)
    .quad(0.195, 0.95, 0.1, 0.97)
    .line(0.05, 0.985)
    .ball(1.035, 0.05)
    .build();

  // Coronet: a ring of small balls on the crown rim.
  const parts = [body];
  const ball = new THREE.SphereGeometry(0.03, 12, 10);
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2;
    const b = ball.clone();
    b.translate(Math.cos(a) * 0.228, 0.9, Math.sin(a) * 0.228);
    parts.push(b);
  }
  ball.dispose();
  return parts;
}

function kingBody() {
  const body = new Profile()
    .base(0.38, 0.22)
    .quad(0.14, 0.35, 0.12, 0.6)
    .collar(0.2, 0.034, 0.16)
    .collar(0.175, 0.022, 0.11)
    .quad(0.15, 0.8, 0.235, 0.9)
    .line(0.24, 0.925)
    .line(0.205, 0.93)
    .quad(0.2, 0.99, 0.12, 1.01)
    .line(0.075, 1.015)
    .collar(0.085, 0.024, 0.04)
    .line(0, 1.05)
    .build();

  // Cross pattée, extruded and bevelled.
  const s = new THREE.Shape();
  const w = 0.032; // half bar width
  const armY = 0.16; // centre height of the arms
  const top = 0.24;
  const arm = 0.095;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, armY - w);
  s.lineTo(arm, armY - w - 0.012);
  s.lineTo(arm, armY + w + 0.012);
  s.lineTo(w, armY + w);
  s.lineTo(w + 0.012, top);
  s.lineTo(-w - 0.012, top);
  s.lineTo(-w, armY + w);
  s.lineTo(-arm, armY + w + 0.012);
  s.lineTo(-arm, armY - w - 0.012);
  s.lineTo(-w, armY - w);
  s.closePath();
  const cross = new THREE.ExtrudeGeometry(s, {
    depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2,
  });
  cross.translate(0, 1.045, -0.02);
  return [body, cross];
}

function knightBody() {
  // Turned base and a short plinth, like the other pieces.
  const base = new Profile()
    .base(0.36, 0.2)
    .line(0.19, 0.19)
    .collar(0.245, 0.03, 0.2)
    .line(0, 0.235)
    .build();

  // Horse head: side silhouette in the XY plane (+X = the way the horse faces),
  // extruded for thickness with a deep round bevel so it reads as carved.
  const s = new THREE.Shape();
  s.moveTo(-0.19, 0);
  s.lineTo(0.15, 0);
  s.quadraticCurveTo(0.21, 0.1, 0.1, 0.2); // chest → throat
  s.quadraticCurveTo(0.12, 0.29, 0.24, 0.33); // jaw
  s.lineTo(0.29, 0.355);
  s.quadraticCurveTo(0.335, 0.4, 0.3, 0.445); // nose
  s.quadraticCurveTo(0.2, 0.5, 0.11, 0.555); // face / forehead
  s.lineTo(0.075, 0.655); // ear front
  s.lineTo(0.02, 0.585); // ear back
  s.quadraticCurveTo(-0.11, 0.57, -0.16, 0.42); // poll → crest
  s.quadraticCurveTo(-0.2, 0.26, -0.24, 0.12); // mane
  s.quadraticCurveTo(-0.24, 0.03, -0.19, 0);
  const head = new THREE.ExtrudeGeometry(s, {
    depth: 0.13, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.03, bevelSegments: 5, curveSegments: 12,
  });
  head.translate(0, 0.215, -0.065);

  // Eye bumps on both cheeks.
  const eye = new THREE.SphereGeometry(0.022, 10, 8);
  const eyeL = eye.clone(); eyeL.translate(0.15, 0.68, 0.11);
  const eyeR = eye.clone(); eyeR.translate(0.15, 0.68, -0.11);
  eye.dispose();
  return [base, head, eyeL, eyeR];
}

// ── merge + cache ──────────────────────────────────────────────────────────

function merge(parts) {
  const list = (Array.isArray(parts) ? parts : [parts]).map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    ng.clearGroups();
    for (const name of Object.keys(ng.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") ng.deleteAttribute(name);
    }
    return ng;
  });
  const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (merged !== list[0]) list.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

const BUILDERS = { p: pawnBody, r: rookBody, n: knightBody, b: bishopBody, q: queenBody, k: kingBody };
const geometryCache = new Map();

export function getPieceGeometry(type) {
  let geo = geometryCache.get(type);
  if (!geo) {
    geo = merge((BUILDERS[type] || pawnBody)());
    geometryCache.set(type, geo);
  }
  return geo;
}
