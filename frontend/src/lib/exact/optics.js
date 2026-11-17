import { parseLooseJson } from "../looseJson.js";
import { INK, arrowHead, clean, fmt, line, num, poly, sheet, text } from "./svg.js";

// ```optics — a ray diagram for a lens or a mirror, worked out from the lens
// or mirror formula: where the image is, how big, which way up, and the
// standard rays drawn exactly through F, 2F (or C) and the centre. The model
// only says what the question gives: the lens or mirror, the focal length
// and where the object is (a distance, or "between F and 2F").

const DEVICES = [
  [/plane/i, "plane mirror"],
  [/conv\w*\s*lens|converging lens|bi-?convex|double convex/i, "convex lens"],
  [/conc\w*\s*lens|diverging lens|bi-?concave|double concave/i, "concave lens"],
  [/conc\w*\s*mirror|converging mirror/i, "concave mirror"],
  [/conv\w*\s*mirror|diverging mirror/i, "convex mirror"],
];

const RAY = "#1e40af";
const IMAGE = "#b91c1c";

// Where "between F and 2F" puts the object, in focal lengths.
function fromPosition(words, device) {
  const w = String(words || "").toLowerCase().replace(/\s+/g, " ");
  if (!w) return null;
  if (/infinit/.test(w)) return Infinity;
  const mirror = /mirror/.test(device);
  const two = mirror ? "(?:2f|c\\b|centre|center)" : "2f";
  if (new RegExp(`beyond ${two}|farther than ${two}|more than ${two}`).test(w)) return 3;
  if (new RegExp(`between (?:f\\w* and ${two}|${two} and f)`).test(w)) return 1.5;
  if (new RegExp(`\\bat ${two}`).test(w)) return 2;
  if (/between (?:f\w* and (?:o|p|pole|optical|the lens|the mirror|lens|mirror)|(?:o|p|pole|optical centre|optical center) and f)/.test(w)) return 0.5;
  if (/\bat f\b|at the focus|at focus|at principal focus/.test(w)) return 1;
  return null;
}

export function parseOptics(input) {
  let raw = null;
  try { raw = parseLooseJson(String(input || "")); } catch { raw = null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "The ray diagram's description isn't readable." };
  const said = String(raw.device ?? raw.type ?? raw.element ?? raw.kind ?? raw.optic ?? raw.lens ?? raw.mirror ?? "");
  const device = DEVICES.find(([re]) => re.test(said))?.[1];
  if (!device) return { error: "It doesn't say which lens or mirror to draw." };
  let f = Math.abs(num(raw.f ?? raw.focal ?? raw.focalLength ?? raw.focal_length));
  const R = Math.abs(num(raw.R ?? raw.radius ?? raw.radiusOfCurvature ?? raw.radius_of_curvature));
  if (!(f > 0) && R > 0) f = R / 2;
  const given = f > 0;
  if (!given) f = 10;
  const object = raw.object && typeof raw.object === "object" ? raw.object : {};
  let u = Math.abs(num(raw.u ?? raw.objectDistance ?? raw.object_distance ?? raw.distance ?? object.distance ?? object.u));
  const at = fromPosition(raw.position ?? raw.objectPosition ?? object.position ?? (typeof raw.object === "string" ? raw.object : ""), device);
  if (!(u > 0) || !Number.isFinite(u)) u = at === Infinity ? Infinity : at ? at * f : (/convex mirror|concave lens|plane/.test(device) ? 1.5 * f : 3 * f);
  let h = Math.abs(num(raw.h ?? raw.height ?? raw.objectHeight ?? raw.object_height ?? object.height ?? object.h));
  if (!(h > 0)) h = f * 0.45;
  return {
    spec: {
      device, f, u, h, focalGiven: given,
      units: clean(raw.units ?? raw.unit ?? "cm", 6) || "cm",
      title: clean(raw.title ?? `Image formation by a ${device}`, 70),
    },
  };
}

// Where the image is and what it is like (lens: Cartesian signs; mirror:
// real-is-positive, with the object in front, on the left).
export function solveOptics({ device, f, u, h }) {
  const lens = /lens/.test(device);
  if (device === "plane mirror") return { x: u, v: -u, m: 1, hi: h, real: false, far: false };
  if (u === Infinity) {
    const x = device === "convex lens" ? f : device === "concave lens" ? -f : device === "concave mirror" ? -f : f;
    return { x, v: lens ? x : -x, m: 0, hi: 0, real: device === "convex lens" || device === "concave mirror", atInfinity: false, fromInfinity: true };
  }
  const fs = device === "convex lens" || device === "concave mirror" ? f : -f;
  const inv = 1 / fs - 1 / u;
  if (Math.abs(inv) < 1e-9 / f) return { x: Infinity, v: Infinity, m: Infinity, hi: Infinity, real: true, atInfinity: true };
  const v = 1 / inv;
  const m = lens ? v / -u : -v / u;
  return { x: lens ? v : -v, v, m, hi: m * h, real: v > 0, atInfinity: false };
}

function describe(spec, img) {
  const { device, f, u, units } = spec;
  const lens = /lens/.test(device);
  const d = (x) => `${fmt(x)} ${units}`;
  const mark = (a, b) => (lens ? [a + "₁", b + "₁"] : [a, b]);
  let where = "";
  if (u === Infinity) where = "at infinity";
  else if (device === "plane mirror") where = `${d(u)} in front of the mirror`;
  else if (/convex mirror|concave lens/.test(device)) where = `${d(u)} from the ${lens ? "lens" : "mirror"}`;
  else {
    const [F, F2] = lens ? mark("F", "2F") : ["F", "C"];
    const k = u / f;
    where = Math.abs(k - 2) < 1e-6 ? `at ${F2}` : Math.abs(k - 1) < 1e-6 ? `at ${F}` : k > 2 ? `beyond ${F2}` : k > 1 ? `between ${F} and ${F2}` : `between ${F} and ${lens ? "O" : "P"}`;
    where += ` (u = ${d(u)})`;
  }
  const obj = `Object ${where}.`;
  if (img.atInfinity) return `${obj} The refracted${lens ? "" : " (reflected)"} rays come out parallel: the image is at infinity, real, inverted and highly magnified.`;
  if (img.fromInfinity) {
    const at = device === "convex lens" ? "at F₂" : device === "concave lens" ? "at F₁ (virtual)" : device === "concave mirror" ? "at F" : "at F, behind the mirror (virtual)";
    return `${obj} The image is ${at}: a point, highly diminished${img.real ? ", real and inverted" : ", virtual and erect"}.`;
  }
  const am = Math.abs(img.m);
  const size = Math.abs(am - 1) < 0.02 ? "the same size" : am > 1 ? "magnified" : "diminished";
  const nature = `${img.real ? "real" : "virtual"}, ${img.m < 0 ? "inverted" : "erect"}, ${size}`;
  let at;
  if (lens) {
    if (!img.real) at = device === "concave lens" ? "between F₁ and O, on the object's side" : "on the same side as the object";
    else {
      const k = img.v / f;
      at = Math.abs(k - 2) < 0.02 ? "at 2F₂" : k > 2 ? "beyond 2F₂" : "between F₂ and 2F₂";
    }
  } else if (device === "plane mirror") at = "as far behind the mirror as the object is in front";
  else if (!img.real) at = device === "convex mirror" ? "behind the mirror, between P and F" : "behind the mirror";
  else {
    const k = img.v / f;
    at = Math.abs(k - 2) < 0.02 ? "at C" : k > 2 ? "beyond C" : "between F and C";
  }
  const v = lens ? `v = ${img.v > 0 ? "+" : "−"}${d(Math.abs(img.v))}` : `${d(Math.abs(img.v))} ${img.real ? "in front of" : "behind"} the mirror`;
  return `${obj} Image ${at}, ${v}: ${nature} (m = ${fmt(img.m)}).`;
}

/** An ```optics block → `{ title, svg, width, height, caption }` or `{ error }`. */
export function renderOptics(code) {
  const { spec, error } = parseOptics(code);
  if (error) return { error };
  const { device, f, u, h } = spec;
  const img = solveOptics(spec);
  const lens = /lens/.test(device);
  const mirror = !lens;

  // The world box: object, image, foci and 2F (or C), with room round them.
  const xs = [0];
  if (device !== "plane mirror") xs.push(...(lens ? [-2 * f, 2 * f] : device === "concave mirror" ? [-2 * f] : [2 * f]));
  if (u !== Infinity) xs.push(-u);
  const imageShown = Number.isFinite(img.x) && Math.abs(img.x) <= Math.max(8 * f, 2.2 * (u === Infinity ? f : u));
  if (imageShown) xs.push(img.x);
  if (device === "plane mirror") xs.push(u);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  const span = x1 - x0 || f * 4;
  x0 -= span * 0.12;
  x1 += span * 0.12;
  if (mirror) x1 = Math.max(x1, span * 0.18);
  const hiShown = imageShown && Number.isFinite(img.hi) ? Math.min(Math.abs(img.hi), 3.2 * h) : 0;
  const H = Math.max(h, hiShown) * 1.45;

  const W = 760;
  const HP = 330;
  const pad = 26;
  const X = (x) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad);
  const Y = (y) => HP / 2 - (y / H) * (HP / 2 - 18);
  const P = ([x, y]) => [X(x), Y(y)];
  const out = [];

  // Where a ray from p going along d leaves the picture.
  const toEdge = (p, d) => {
    let t = Infinity;
    if (d[0] > 1e-12) t = Math.min(t, (x1 - p[0]) / d[0]);
    if (d[0] < -1e-12) t = Math.min(t, (x0 - p[0]) / d[0]);
    if (d[1] > 1e-12) t = Math.min(t, (H - p[1]) / d[1]);
    if (d[1] < -1e-12) t = Math.min(t, (-H - p[1]) / d[1]);
    return [p[0] + d[0] * t, p[1] + d[1] * t];
  };
  const solid = (a, b, arrow = true) => {
    out.push(line(P(a), P(b), `stroke="${RAY}" stroke-width="1.6" fill="none"`));
    if (arrow) {
      const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      const pa = P(a);
      const pb = P(b);
      if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 30) out.push(arrowHead(m, [pb[0] - pa[0], pb[1] - pa[1]], 9, 3.4, RAY));
    }
  };
  const dashed = (a, b) => out.push(line(P(a), P(b), `stroke="${RAY}" stroke-width="1.3" stroke-dasharray="6 4" fill="none"`));

  // Principal axis.
  out.push(line([X(x0), Y(0)], [X(x1), Y(0)], `stroke="${INK}" stroke-width="1.1"`));

  // The lens or mirror.
  const HL = H * 0.93;
  const thick = (x1 - x0) * 0.012;
  if (device === "convex lens" || device === "concave lens") {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const y = -HL + (2 * HL * i) / 24;
      const k = 1 - (y / HL) ** 2;
      pts.push(device === "convex lens" ? [thick * k, y] : [thick * 0.5 + thick * (1 - k), y]);
    }
    const right = pts.map(P);
    const left = pts.map(([x, y]) => P([-x, y])).reverse();
    out.push(poly([...right, ...left], `fill="#dbeafe" fill-opacity="0.6" stroke="${INK}" stroke-width="1.4"`, true));
  } else {
    const sag = device === "plane mirror" ? 0 : (x1 - x0) * 0.018 * (device === "concave mirror" ? -1 : 1);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const y = -HL + (2 * HL * i) / 24;
      pts.push([sag * (y / HL) ** 2, y]);
    }
    out.push(poly(pts.map(P), `fill="none" stroke="${INK}" stroke-width="2.2"`));
    // Silvering hatched on the back.
    for (let i = 1; i < 12; i++) {
      const y = -HL + (2 * HL * i) / 12;
      const p = P([sag * (y / HL) ** 2, y]);
      out.push(line(p, [p[0] + 9, p[1] + 7], `stroke="${INK}" stroke-width="1"`));
    }
  }

  // F, 2F (or F, C) and the centre.
  const marks = [];
  if (lens) marks.push([-f, "F₁"], [f, "F₂"], [-2 * f, "2F₁"], [2 * f, "2F₂"], [0, "O"]);
  else if (device === "concave mirror") marks.push([-f, "F"], [-2 * f, "C"], [0, "P"]);
  else if (device === "convex mirror") marks.push([f, "F"], [2 * f, "C"], [0, "P"]);
  else marks.push([0, "P"]);
  for (const [x, label] of marks) {
    const p = P([x, 0]);
    if (x !== 0) out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${INK}"/>`);
    out.push(text(p[0] + (x === 0 ? 9 : 0), p[1] + 17, label, `font-size="13" text-anchor="middle" fill="${INK}"`));
  }

  // The object, and the image.
  const objTop = [-u, h];
  if (u !== Infinity) {
    out.push(line(P([-u, 0]), P(objTop), `stroke="${INK}" stroke-width="2.4"`));
    out.push(arrowHead(P(objTop), [0, -1], 11, 5, INK));
    out.push(text(P(objTop)[0], P(objTop)[1] - 8, "B", `font-size="13" text-anchor="middle" font-weight="700" fill="${INK}"`));
    // Above the axis, beside the arrow's foot: F and 2F are below it.
    out.push(text(P([-u, 0])[0] - 9, P([-u, 0])[1] - 6, "A", `font-size="13" text-anchor="middle" font-weight="700" fill="${INK}"`));
  }

  // The rays.
  if (u === Infinity) {
    for (const y of [H * 0.55, H * 0.25, -H * 0.25]) {
      const hit = [0, y];
      solid([x0, y], hit);
      if (lens) {
        const focus = device === "convex lens" ? [f, 0] : [-f, 0];
        const dir = device === "convex lens" ? [focus[0], -y] : [f, y];
        solid(hit, toEdge(hit, dir));
        if (device === "concave lens") dashed(hit, focus);
      } else {
        const focus = device === "concave mirror" ? [-f, 0] : [f, 0];
        const dir = device === "concave mirror" ? [-f, -y] : [-f, y];
        solid(hit, toEdge(hit, dir));
        if (device === "convex mirror") dashed(hit, focus);
      }
    }
  } else if (lens) {
    const convex = device === "convex lens";
    const imageTop = imageShown ? [img.x, img.hi] : null;
    // 1: parallel to the axis, then through F₂ (or as if from F₁).
    const a1 = [0, h];
    solid(objTop, a1);
    const d1 = convex ? [f, -h] : [f, h];
    solid(a1, toEdge(a1, d1));
    if (!convex) dashed(a1, [-f, 0]);
    else if (!img.real && imageTop) dashed(a1, imageTop);
    // 2: through the optical centre, straight on.
    solid(objTop, [0, 0]);
    solid([0, 0], toEdge([0, 0], [u, -h]));
    if (!img.real && convex && imageTop) dashed(objTop, imageTop);
    // 3: through F₁ (or toward F₂), then parallel to the axis.
    if (Math.abs(u - f) > 1e-9 || !convex) {
      const y3 = convex ? (h * f) / (f - u) : (h * f) / (f + u);
      if (Math.abs(y3) < H * 0.97) {
        const a3 = [0, y3];
        solid(objTop, a3);
        if (convex && u < f) dashed([-f, 0], objTop);
        if (!convex) dashed(a3, [f, 0]);
        solid(a3, toEdge(a3, [1, 0]));
        if (!img.real && imageTop) dashed(a3, [imageTop[0] - (x1 - x0) * 0.02, y3]);
      }
    }
  } else if (device === "plane mirror") {
    for (const y of [0, -h * 0.9]) {
      const hit = [0, y];
      solid(objTop, hit);
      solid(hit, toEdge(hit, [-u, y - h]));
      dashed(hit, [u, h]);
    }
  } else {
    const concave = device === "concave mirror";
    const imageTop = imageShown ? [img.x, img.hi] : null;
    // 1: parallel to the axis, back through F (or as if from F behind).
    const a1 = [0, h];
    solid(objTop, a1);
    solid(a1, toEdge(a1, concave ? [-f, -h] : [-f, h]));
    if (!concave) dashed(a1, [f, 0]);
    else if (!img.real && imageTop) dashed(a1, imageTop);
    // 2: toward F, back parallel to the axis.
    if (Math.abs(u - f) > 1e-9 || !concave) {
      const y2 = concave ? (h * f) / (f - u) : (h * f) / (f + u);
      if (Math.abs(y2) < H * 0.97) {
        const a2 = [0, y2];
        solid(objTop, a2);
        if (concave && u < f) dashed([-f, 0], objTop);
        if (!concave) dashed(a2, [f, 0]);
        solid(a2, toEdge(a2, [-1, 0]));
        if (!img.real && imageTop) dashed(a2, [imageTop[0] + (x1 - x0) * 0.02, y2]);
      }
    }
    // 3: to the pole, back at the same angle.
    solid(objTop, [0, 0]);
    solid([0, 0], toEdge([0, 0], [-u, -h]));
    if (!img.real && imageTop) dashed([0, 0], imageTop);
  }

  if (imageShown && Number.isFinite(img.hi) && Math.abs(img.hi) > 1e-9) {
    const top = [img.x, Math.max(-H * 0.98, Math.min(H * 0.98, img.hi))];
    const attrs = img.real ? `stroke="${IMAGE}" stroke-width="2.4"` : `stroke="${IMAGE}" stroke-width="2.2" stroke-dasharray="5 3"`;
    out.push(line(P([img.x, 0]), P(top), attrs));
    out.push(arrowHead(P(top), [0, top[1] > 0 ? -1 : 1], 11, 5, IMAGE));
    out.push(text(P(top)[0], P(top)[1] + (top[1] > 0 ? -8 : 18), "B′", `font-size="13" text-anchor="middle" font-weight="700" fill="${IMAGE}"`));
    out.push(text(P([img.x, 0])[0] + 11, P([img.x, 0])[1] + (top[1] > 0 ? -6 : -6), "A′", `font-size="13" text-anchor="middle" font-weight="700" fill="${IMAGE}"`));
  } else if (img.fromInfinity) {
    out.push(`<circle cx="${P([img.x, 0])[0]}" cy="${P([img.x, 0])[1]}" r="4" fill="${IMAGE}"/>`);
  }

  const caption = describe(spec, img) + (!imageShown && Number.isFinite(img.x) ? " (The image is too far away to fit in the picture.)" : "");
  const drawn = sheet({ width: W, height: HP, title: spec.title, body: out.join(""), caption });
  return { title: spec.title, ...drawn, caption, image: img };
}
