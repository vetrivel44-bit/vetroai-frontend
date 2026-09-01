import * as THREE from "three";

// Turned-wood Staunton piece geometry, built procedurally with THREE.LatheGeometry
// profiles so every piece shares the same "turned on a lathe" silhouette language
// real chess sets use. A handful of control points (radius, height-fraction) are
// run through a Catmull-Rom spline and densely resampled before going into the
// lathe, so the surface reads as smoothly turned wood rather than stacked rings.
// Radius is an absolute fraction of one board square; height fractions are
// multiplied by that piece's own total height. Everything is cached at module
// scope — geometries are built once and reused across every instance.

const RADIAL_SEGMENTS = 32;
const PROFILE_SAMPLES = 56;

function smoothLathe(controlPoints, height) {
  const cps = controlPoints.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001), h * height));
  const curve = new THREE.SplineCurve(cps);
  const pts = curve.getPoints(PROFILE_SAMPLES);
  const geo = new THREE.LatheGeometry(pts, RADIAL_SEGMENTS);
  geo.computeVertexNormals();
  return geo;
}

// Shared bottom section every piece starts with: flat foot, taper, a single
// collar ring, taper into the shaft. Height fraction 0 → 0.16.
const BASE = [
  [0.42, 0],
  [0.42, 0.03],
  [0.33, 0.07],
  [0.34, 0.1],
  [0.2, 0.16],
];

const PROFILES = {
  p: {
    height: 0.55,
    points: [...BASE, [0.155, 0.16], [0.15, 0.46], [0.2, 0.54], [0.135, 0.6], [0.27, 0.68], [0.3, 0.76], [0.265, 0.83], [0.1, 0.9], [0, 0.95]],
  },
  r: {
    height: 0.62,
    points: [...BASE, [0.19, 0.16], [0.2, 0.42], [0.21, 0.48], [0.36, 0.56], [0.36, 0.62]],
    flatTopRadius: 0.36,
  },
  b: {
    height: 0.78,
    points: [...BASE, [0.19, 0.16], [0.19, 0.38], [0.27, 0.47], [0.2, 0.58], [0.14, 0.64], [0.24, 0.72], [0.14, 0.82], [0, 0.9]],
  },
  q: {
    height: 0.9,
    points: [...BASE, [0.2, 0.16], [0.21, 0.45], [0.21, 0.52], [0.15, 0.58], [0.31, 0.68], [0.24, 0.76], [0.17, 0.8], [0.24, 0.86], [0.27, 0.92], [0.1, 0.98], [0, 1]],
  },
  k: {
    height: 0.98,
    points: [...BASE, [0.21, 0.16], [0.22, 0.47], [0.22, 0.54], [0.16, 0.6], [0.32, 0.7], [0.26, 0.77], [0.18, 0.82], [0.25, 0.88], [0.28, 0.93], [0.16, 0.97], [0.1, 1]],
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
  const result = { geo, y: h * 0.62 };
  decorationCache.set("rookTopCap", result);
  return result;
}

// Rook crenellations: small merlon boxes around the flat top rim.
export function getRookMerlons() {
  if (decorationCache.has("rookMerlons")) return decorationCache.get("rookMerlons");
  const h = PROFILES.r.height;
  const geo = new THREE.BoxGeometry(0.095, 0.085, 0.095);
  const y = h * 0.62 + 0.04;
  const transforms = ring(8, 0.31, (x, z) => ({ x, z, y }));
  const result = { geo, transforms };
  decorationCache.set("rookMerlons", result);
  return result;
}

// Queen's coronet: small cone spikes ringing the crown base.
export function getQueenSpikes() {
  if (decorationCache.has("queenSpikes")) return decorationCache.get("queenSpikes");
  const h = PROFILES.q.height;
  const geo = new THREE.ConeGeometry(0.042, 0.13, 8);
  const y = h * 0.68 + 0.055;
  const transforms = ring(8, 0.285, (x, z) => ({ x, z, y }));
  const result = { geo, transforms };
  decorationCache.set("queenSpikes", result);
  return result;
}

// Bishop's mitre topper — the small ball sitting above the slanted mitre tip.
export function getBishopBall() {
  if (decorationCache.has("bishopBall")) return decorationCache.get("bishopBall");
  const h = PROFILES.b.height;
  const geo = new THREE.SphereGeometry(0.055, 16, 12);
  const result = { geo, y: h * 0.9 + 0.045 };
  decorationCache.set("bishopBall", result);
  return result;
}

// King's cross — two thin crossed boxes above the ball.
export function getKingCross() {
  if (decorationCache.has("kingCross")) return decorationCache.get("kingCross");
  const h = PROFILES.k.height;
  const vertical = new THREE.BoxGeometry(0.042, 0.19, 0.042);
  const horizontal = new THREE.BoxGeometry(0.15, 0.042, 0.042);
  const result = { vertical, horizontal, y: h + 0.08 };
  decorationCache.set("kingCross", result);
  return result;
}

// ── knight (not radially symmetric — extruded silhouette) ──────────────────

export function getKnightGeometry() {
  if (decorationCache.has("knight")) return decorationCache.get("knight");

  // Base + short shaft shares the family's turned-base language.
  const baseGeo = smoothLathe([...BASE, [0.18, 0.16], [0.19, 0.28], [0.19, 0.3]], 0.68);

  // Horse-head silhouette in the XY plane (X = facing direction, Y = height),
  // extruded along Z for thickness. Roughly: neck → mane → ears → forehead →
  // muzzle → jaw → throat → chest, closing back at the base.
  const shape = new THREE.Shape();
  const pts = [
    [-0.15, 0.0],
    [-0.19, 0.09],
    [-0.14, 0.19],
    [-0.19, 0.24],
    [-0.13, 0.33],
    [-0.16, 0.37],
    [-0.09, 0.44],
    [-0.11, 0.5],
    [-0.05, 0.48],
    [-0.07, 0.54],
    [0.0, 0.48],
    [0.11, 0.46],
    [0.24, 0.4],
    [0.21, 0.34],
    [0.26, 0.3],
    [0.17, 0.25],
    [0.21, 0.2],
    [0.1, 0.13],
    [0.14, 0.05],
    [0.02, 0.0],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.17,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.018,
    bevelSegments: 3,
    curveSegments: 10,
  });
  headGeo.translate(0, 0, -0.085);
  headGeo.computeVertexNormals();

  const result = { baseGeo, headGeo, headY: 0.68 * 0.3 };
  decorationCache.set("knight", result);
  return result;
}
