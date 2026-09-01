import * as THREE from "three";

// Turned-wood Staunton piece geometry, built procedurally with THREE.LatheGeometry
// profiles so every piece shares the same "turned on a lathe" silhouette language
// real chess sets use. A handful of control points (radius, height-fraction) are
// run through a Catmull-Rom spline and densely resampled before going into the
// lathe, so the surface reads as smoothly turned wood. Control points are spaced
// with deliberately large radius swings so each piece keeps a distinct, readable
// silhouette after smoothing instead of blurring into a generic blob.
// Radius is an absolute fraction of one board square; height fractions are
// multiplied by that piece's own total height. Everything is cached at module
// scope — geometries are built once and reused across every instance.

const RADIAL_SEGMENTS = 40;
const PROFILE_SAMPLES = 72;

function smoothLathe(controlPoints, height) {
  const cps = controlPoints.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001), h * height));
  const curve = new THREE.SplineCurve(cps);
  const pts = curve.getPoints(PROFILE_SAMPLES);
  const geo = new THREE.LatheGeometry(pts, RADIAL_SEGMENTS);
  geo.computeVertexNormals();
  return geo;
}

// Shared bottom section every piece starts with: wide flat foot, one crisp
// taper into the shaft. Height fraction 0 → 0.14.
const BASE = [
  [0.46, 0],
  [0.46, 0.03],
  [0.36, 0.06],
  [0.37, 0.085],
  [0.24, 0.14],
];

const PROFILES = {
  // Simple stem, then a sharp neck-to-ball jump so the head reads as a
  // distinct sphere, not a continuation of the shaft.
  p: {
    height: 0.52,
    points: [...BASE, [0.16, 0.14], [0.155, 0.44], [0.21, 0.52], [0.115, 0.6], [0.29, 0.72], [0.32, 0.79], [0.26, 0.86], [0.08, 0.93], [0, 0.97]],
  },
  // Near-cylindrical barrel (not a taper) so it reads architectural, flaring
  // to a wide flat-topped rim that the crenellations sit on.
  r: {
    height: 0.64,
    points: [...BASE, [0.21, 0.14], [0.215, 0.46], [0.23, 0.52], [0.4, 0.6], [0.4, 0.66]],
    flatTopRadius: 0.4,
  },
  // Slim waist, then a true pointed cone for the mitre (tapers all the way
  // to a point) — the ball topper sits above it separately.
  b: {
    height: 0.82,
    points: [...BASE, [0.19, 0.14], [0.185, 0.4], [0.27, 0.5], [0.19, 0.6], [0.105, 0.65], [0.24, 0.71], [0, 0.85]],
  },
  // Crown flares wide, curls back in like a cup/coronet, then a ball tip.
  q: {
    height: 0.94,
    points: [...BASE, [0.2, 0.14], [0.195, 0.46], [0.14, 0.54], [0.35, 0.65], [0.24, 0.73], [0.22, 0.77], [0.26, 0.82], [0.29, 0.88], [0.09, 0.96], [0, 1]],
  },
  // Same family as the queen but a wider crown and taller overall — the
  // tallest piece on the board, topped by the cross instead of a point.
  k: {
    height: 1.0,
    points: [...BASE, [0.21, 0.14], [0.205, 0.47], [0.15, 0.55], [0.38, 0.66], [0.26, 0.74], [0.23, 0.78], [0.27, 0.83], [0.3, 0.89], [0.15, 0.96], [0.09, 1]],
  },
};

const geometryCache = new Map();
const decorationCache = new Map();

export function getBodyGeometry(type) {
  if (geometryCache.has(type)) return geometryCache.get(type);
  const profile = PROFILES[type];
  const geo = profile ? smoothLathe(profile.points, profile.height) : smoothLathe(PROFILES.p.points, PROFILES.p.height);
  geometryCache.set(type, geo);
  return geo;
}

export function getTotalHeight(type) {
  return (PROFILES[type] || PROFILES.p).height;
}

// ── decorative extras ───────────────────────────────────────────────────────

function ring(count, radius, build) {
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    items.push(build(Math.cos(angle) * radius, Math.sin(angle) * radius, angle));
  }
  return items;
}

// Rook's flat top needs an explicit cap disc (the lathe profile ends open).
export function getRookTopCap() {
  if (decorationCache.has("rookTopCap")) return decorationCache.get("rookTopCap");
  const h = PROFILES.r.height;
  const geo = new THREE.CircleGeometry(PROFILES.r.flatTopRadius, RADIAL_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const result = { geo, y: h * 0.66 };
  decorationCache.set("rookTopCap", result);
  return result;
}

// Rook crenellations: a handful of big, clearly-separated castle merlons
// around the rim — few and chunky, not a fuzzy ring of tiny spikes.
export function getRookMerlons() {
  if (decorationCache.has("rookMerlons")) return decorationCache.get("rookMerlons");
  const h = PROFILES.r.height;
  const geo = new THREE.BoxGeometry(0.15, 0.17, 0.11);
  const y = h * 0.66 + 0.075;
  const transforms = ring(6, 0.335, (x, z, angle) => ({ x, z, y, angle }));
  const result = { geo, transforms };
  decorationCache.set("rookMerlons", result);
  return result;
}

// Queen's coronet: bold cone spikes right at the crown's widest rim.
export function getQueenSpikes() {
  if (decorationCache.has("queenSpikes")) return decorationCache.get("queenSpikes");
  const h = PROFILES.q.height;
  const geo = new THREE.ConeGeometry(0.052, 0.19, 8);
  const y = h * 0.65 + 0.075;
  const transforms = ring(6, 0.33, (x, z) => ({ x, z, y }));
  const result = { geo, transforms };
  decorationCache.set("queenSpikes", result);
  return result;
}

// Bishop's mitre topper — the small ball sitting above the pointed mitre tip.
export function getBishopBall() {
  if (decorationCache.has("bishopBall")) return decorationCache.get("bishopBall");
  const h = PROFILES.b.height;
  const geo = new THREE.SphereGeometry(0.065, 18, 14);
  const result = { geo, y: h * 0.85 + 0.06 };
  decorationCache.set("bishopBall", result);
  return result;
}

// King's cross — two thin crossed boxes above the ball.
export function getKingCross() {
  if (decorationCache.has("kingCross")) return decorationCache.get("kingCross");
  const h = PROFILES.k.height;
  const vertical = new THREE.BoxGeometry(0.048, 0.22, 0.048);
  const horizontal = new THREE.BoxGeometry(0.17, 0.048, 0.048);
  const result = { vertical, horizontal, y: h + 0.09 };
  decorationCache.set("kingCross", result);
  return result;
}

// ── knight (not radially symmetric — extruded silhouette) ──────────────────

export function getKnightGeometry() {
  if (decorationCache.has("knight")) return decorationCache.get("knight");

  // Base + short shaft shares the family's turned-base language.
  const baseGeo = smoothLathe([...BASE, [0.19, 0.14], [0.205, 0.27], [0.2, 0.3]], 0.72);

  // Horse-head silhouette in the XY plane (X = facing direction, Y = height),
  // extruded along Z for thickness. Taller and more angular than a rounded
  // blob: a clear back-of-neck mane ridge, pointed ear, muzzle jutting
  // forward with a notch for the mouth, and a curved throat/chest line.
  const shape = new THREE.Shape();
  const pts = [
    [-0.16, 0.0],
    [-0.21, 0.08],
    [-0.15, 0.16],
    [-0.22, 0.22],
    [-0.14, 0.3],
    [-0.2, 0.36],
    [-0.12, 0.44],
    [-0.17, 0.5],
    [-0.08, 0.56],
    [-0.12, 0.62],
    [-0.02, 0.66],
    [0.02, 0.74],
    [0.1, 0.7],
    [0.09, 0.62],
    [0.16, 0.58],
    [0.29, 0.5],
    [0.33, 0.42],
    [0.25, 0.4],
    [0.3, 0.33],
    [0.19, 0.29],
    [0.24, 0.22],
    [0.11, 0.16],
    [0.15, 0.07],
    [0.02, 0.0],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.19,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 6,
  });
  headGeo.translate(0, 0, -0.095);
  headGeo.computeVertexNormals();

  const result = { baseGeo, headGeo, headY: 0.72 * 0.3 };
  decorationCache.set("knight", result);
  return result;
}
