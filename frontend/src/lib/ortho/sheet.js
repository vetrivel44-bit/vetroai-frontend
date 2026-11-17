import { buildSolid } from "./solid.js";
import { VIEWS, drawView, findEdges, roundFaces } from "./edges.js";

// The drawing sheet, as the BIS (SP 46 / IS 10711–10714) and ISO conventions
// ask: the views in first- or third-angle positions, lined up with each
// other; visible edges thick and continuous, hidden ones dashed, centre lines
// chain-dotted; a 45° miter line carrying depths between the top and side
// views; aligned dimensions with filled arrowheads; a border with a filing
// margin, and a title block with the scale and the projection symbol.
// Paper units are millimetres, so a printed sheet is true to scale.

const SHEETS = [["A4", 297, 210], ["A3", 420, 297], ["A2", 594, 420], ["A1", 841, 594], ["A0", 1189, 841]];
const SCALES = [[5, "5:1"], [2, "2:1"], [1, "1:1"], [0.5, "1:2"], [0.4, "1:2.5"], [0.2, "1:5"], [0.1, "1:10"], [0.05, "1:20"], [0.02, "1:50"], [0.01, "1:100"]];
const FONT = 3.5; // dimension figures
const DIM_FIRST = 10; // first dimension line from the view
const DIM_STEP = 8; // between stacked dimension lines
const ARROW = 3;
const GAP_MIN = 24; // between views
const TITLE_BLOCK = [150, 36];
const MARGIN = { left: 20, right: 10, top: 10, bottom: 10 }; // the left one for filing

const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(/(\.\d*?)0+$/, "$1");
};
const textWidth = (s, size = FONT) => String(s).length * size * 0.6;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (v) => Math.round(v * 100) / 100;

const VIEW_TITLE = { front: "FRONT VIEW", top: "TOP VIEW", left: "LEFT SIDE VIEW", right: "RIGHT SIDE VIEW" };

// Which way a model axis runs on the paper in a view: along the paper's
// horizontal ("h") or vertical ("v"), and whether it is reversed.
function paperAxis(name, axis) {
  const v = VIEWS[name];
  if (Math.abs(v.right[axis]) > 0.5) return { dir: "h", sign: Math.sign(v.right[axis]) };
  if (Math.abs(v.up[axis]) > 0.5) return { dir: "v", sign: Math.sign(v.up[axis]) };
  return null;
}

// The solid's box as a view sees it, in the view's own millimetres.
function viewBox(solid, name) {
  const v = VIEWS[name];
  const xs = [];
  const ys = [];
  for (const x of [solid.min[0], solid.max[0]]) for (const y of [solid.min[1], solid.max[1]]) for (const z of [solid.min[2], solid.max[2]]) {
    xs.push(x * v.right[0] + y * v.right[1] + z * v.right[2]);
    ys.push(x * v.up[0] + y * v.up[1] + z * v.up[2]);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * The finished sheet for a checked spec (spec.js): `{ svg, width, height,
 * sheet, scale, iso, notes }` — `svg` the drawing as SVG text in paper
 * millimetres, `iso` a small pictorial view of the solid as read, so the
 * user can check it is the object in the question.
 */
export function drawSheet(spec, { solid: given } = {}) {
  const solid = given || buildSolid(spec.parts);
  const edges = findEdges(solid);
  const rounds = roundFaces(solid);
  const notes = [];
  if (spec.skipped?.length) notes.push(`Left out ${spec.skipped.length === 1 ? "a part" : `${spec.skipped.length} parts`} that couldn't be read: ${spec.skipped.slice(0, 3).join(", ")}.`);

  // Grid positions: front at (0, 0); top below it (first angle) or above
  // (third); the side view beside it — a left view goes on the right in first
  // angle, on the left in third, and the other way round for a right view.
  const names = spec.views.filter((n) => VIEWS[n]);
  const sideName = names.find((n) => n === "left" || n === "right");
  const planRow = spec.projection === "third" ? 1 : -1;
  const sideCol = !sideName ? 0 : (spec.projection === "first") === (sideName === "left") ? 1 : -1;
  const cell = { front: [0, 0], top: [0, planRow] };
  if (sideName) cell[sideName] = [sideCol, 0];
  const taken = new Set(names.map((n) => cell[n].join(",")));
  if (names.includes("top") && sideName) taken.add(`${sideCol},${planRow}`); // the miter line's corner

  const views = names.map((name) => ({ name, geo: drawView(solid, edges, name), box: viewBox(solid, name), dims: { top: [], bottom: [], left: [], right: [] } }));
  const byName = Object.fromEntries(views.map((v) => [v.name, v]));

  // Dimensions: each in a view that shows its axis, on a side of the view
  // facing open paper, stacked with the shortest nearest the view.
  const wanted = [];
  const seen = new Set();
  const want = (d) => {
    const id = `${d.axis}|${r2(d.from)}|${r2(d.to)}`;
    if (seen.has(id)) return;
    seen.add(id);
    wanted.push(d);
  };
  for (const d of spec.dims) want(d);
  // The overall sizes, always.
  want({ view: "front", axis: 0, from: solid.min[0], to: solid.max[0] });
  want({ view: "front", axis: 1, from: solid.min[1], to: solid.max[1] });
  want({ view: sideName ? "side" : "top", axis: 2, from: solid.min[2], to: solid.max[2] });
  for (const d of wanted) {
    const preferred = d.view === "side" ? sideName : d.view;
    const order = [preferred, ...(d.axis === 2 ? [sideName, "top"] : d.axis === 1 ? ["front", sideName] : ["front", "top"])].filter((n) => n && byName[n]);
    const name = order.find((n) => paperAxis(n, d.axis));
    if (!name) continue;
    const { dir, sign } = paperAxis(name, d.axis);
    const v = byName[name];
    const [col, row] = cell[name];
    const sides = dir === "h" ? [["top", [col, row + 1]], ["bottom", [col, row - 1]]] : [["left", [col - 1, row]], ["right", [col + 1, row]]];
    const open = sides.filter(([, c]) => !taken.has(c.join(",")));
    const side = (d.side && sides.some(([s]) => s === d.side)) ? d.side : (open[0] || sides[0])[0];
    const a = sign * d.from;
    const b = sign * d.to;
    v.dims[side].push({ dir, lo: Math.min(a, b), hi: Math.max(a, b), value: d.to - d.from, axis: d.axis });
  }

  // Scale: the one asked for, if the sheet can hold it; else the largest
  // standard one that fits an A3 sheet.
  const spanW = views.reduce((s, v) => s + (cell[v.name][1] === 0 ? v.box.x1 - v.box.x0 : 0), 0);
  const spanH = views.reduce((s, v) => s + (cell[v.name][0] === 0 ? v.box.y1 - v.box.y0 : 0), 0);
  const fits = (k, sheet) => spanW * k + 130 <= sheet[1] - 30 && spanH * k + 120 <= sheet[2] - 20;
  let k = spec.scale?.factor;
  let scaleLabel = spec.scale?.label;
  if (!k || !SHEETS.some((s) => fits(k, s))) {
    if (k) notes.push(`Drawn at a smaller scale than ${scaleLabel} so it fits the sheet.`);
    const pick = SCALES.find(([f]) => f <= 1 && fits(f, SHEETS[1])) || SCALES.find(([f]) => fits(f, SHEETS[SHEETS.length - 1])) || SCALES[SCALES.length - 1];
    // A small part is drawn larger.
    const big = SCALES.find(([f]) => f > 1 && fits(f, SHEETS[0]) && Math.max(spanW, spanH) * f <= 260);
    [k, scaleLabel] = !spec.scale && big && Math.max(spanW, spanH) < 40 ? big : pick;
  }

  // Each view's pieces on paper, its outline box and how much room its
  // dimensions need on each side.
  for (const v of views) {
    v.w = (v.box.x1 - v.box.x0) * k;
    v.h = (v.box.y1 - v.box.y0) * k;
    v.room = {};
    for (const side of ["top", "bottom", "left", "right"]) {
      const list = v.dims[side].sort((p, q) => (p.hi - p.lo) - (q.hi - q.lo));
      const levels = [];
      for (const d of list) {
        const span = (d.hi - d.lo) * k;
        const label = fmt(d.value);
        d.label = label;
        // Arrows inside if they fit; the figure sits above the line, so it
        // only needs the span's width — else both go just outside.
        d.outside = span < 2 * ARROW + 1;
        d.textOutside = span < textWidth(label) + 1;
        const extra = d.textOutside ? textWidth(label) + 4 : 0;
        const a = d.lo * k - (d.outside ? ARROW + 2 : 0);
        const b = d.hi * k + extra + (d.outside ? ARROW : 0);
        // Chained dimensions (0–15, 15–50) share a line.
        let level = levels.findIndex((used) => used.every(([p, q]) => b <= p + 0.01 || a >= q - 0.01));
        if (level < 0) { level = levels.length; levels.push([]); }
        levels[level].push([a, b]);
        d.level = level;
      }
      v.room[side] = levels.length ? DIM_FIRST + (levels.length - 1) * DIM_STEP + FONT + 2.5 : 5;
    }
    v.room.bottom += 9; // the view's name
  }

  // Lay the views out: front first, the others lined up with it.
  const place = (v, x, y) => { v.x = x; v.y = y; }; // the outline box's bottom-left corner on paper
  const F = byName.front;
  place(F, 0, 0);
  const T = byName.top;
  if (T) {
    const gap = planRow < 0 ? Math.max(GAP_MIN, F.room.bottom + T.room.top) : Math.max(GAP_MIN, F.room.top + T.room.bottom);
    place(T, F.x + (T.box.x0 - F.box.x0) * k, planRow < 0 ? -gap - T.h : F.h + gap);
  }
  const S = sideName && byName[sideName];
  if (S) {
    const gap = sideCol > 0 ? Math.max(GAP_MIN, F.room.right + S.room.left) : Math.max(GAP_MIN, F.room.left + S.room.right);
    place(S, sideCol > 0 ? F.w + gap : -gap - S.w, F.y + (S.box.y0 - F.box.y0) * k);
  }
  // From a view's own millimetres to paper.
  for (const v of views) {
    const { x0, y0 } = v.box;
    v.paper = ([px, py]) => [v.x + (px - x0) * k, v.y + (py - y0) * k];
    v.along = (dir, c) => (dir === "h" ? v.x + (c - x0) * k : v.y + (c - v.box.y0) * k);
  }

  const out = { visible: [], hidden: [], centre: [], thin: [], arrows: [], texts: [] };
  const seg = (list, a, b) => list.push([a, b]);

  // The 45° miter line: a depth in the top view meets it and turns up (or
  // down) into the side view at the same depth.
  if (T && S) {
    const zs = [solid.min[2] - 8 / k, solid.max[2] + 8 / k];
    const pt = (z) => {
      const tq = VIEWS.top.up[2] * z;
      const sq = VIEWS[sideName].right[2] * z;
      return [S.x + (sq - S.box.x0) * k, T.y + (tq - T.box.y0) * k];
    };
    seg(out.thin, pt(zs[0]), pt(zs[1]));
  }

  // The views' lines.
  for (const v of views) {
    for (const p of v.geo.pieces) {
      const pts = (p.type === "seg" ? [p.a, p.b] : p.pts).map(v.paper);
      (p.hidden ? out.hidden : out.visible).push(pts);
    }
  }

  // Centre lines of holes and round faces: crossed where the face is seen
  // end-on (a circle), one along the axis where it is seen from the side.
  // One chain line where two would overlap (a counterbore and its hole).
  const addCentre = (a, b) => {
    const flat = Math.abs(a[1] - b[1]) < 1e-6;
    const upright = Math.abs(a[0] - b[0]) < 1e-6;
    if (flat || upright) {
      const ax = flat ? 0 : 1;
      const lo = Math.min(a[ax], b[ax]);
      const hi = Math.max(a[ax], b[ax]);
      const same = out.centre.find(([p, q]) => Math.abs(p[1 - ax] - a[1 - ax]) < 0.05 && Math.abs(q[1 - ax] - a[1 - ax]) < 0.05
        && Math.abs(p[ax === 0 ? 1 : 0] - q[ax === 0 ? 1 : 0]) < 1e-6 && Math.max(p[ax], q[ax]) >= lo - 0.5 && Math.min(p[ax], q[ax]) <= hi + 0.5);
      if (same) {
        const all = [same[0][ax], same[1][ax], lo, hi];
        same[0][ax] = Math.min(...all);
        same[1][ax] = Math.max(...all);
        return;
      }
    }
    out.centre.push([[...a], [...b]]);
  };
  const circles = []; // for the Ø dimensions
  for (const rf of rounds) {
    const [j, kk] = rf.axis === 0 ? [1, 2] : rf.axis === 1 ? [0, 2] : [0, 1];
    const centreAt = (t) => { const p = [0, 0, 0]; p[rf.axis] = t; p[j] = rf.center[0]; p[kk] = rf.center[1]; return p; };
    for (const v of views) {
      const view = VIEWS[v.name];
      const over = 3; // past the outline
      if (Math.abs(view.toViewer[rf.axis]) > 0.5) {
        const c = v.paper(v.geo.project(centreAt(rf.from)));
        const R = rf.r * k;
        addCentre([c[0] - R - over, c[1]], [c[0] + R + over, c[1]]);
        addCentre([c[0], c[1] - R - over], [c[0], c[1] + R + over]);
        circles.push({ rf, view: v, c, R });
      } else {
        const a = v.paper(v.geo.project(centreAt(rf.from)));
        const b = v.paper(v.geo.project(centreAt(rf.to)));
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        addCentre([a[0] - u[0] * over, a[1] - u[1] * over], [b[0] + u[0] * over, b[1] + u[1] * over]);
      }
    }
  }

  // Linear dimensions.
  for (const v of views) {
    const box = { x0: v.x, x1: v.x + v.w, y0: v.y, y1: v.y + v.h };
    const lines = v.geo.pieces.map((p) => ({ hidden: p.hidden, pts: (p.type === "seg" ? [p.a, p.b] : p.pts).map(v.paper) }));
    const centres = out.centre.map((pts) => ({ hidden: false, pts }));
    for (const side of ["top", "bottom", "left", "right"]) {
      for (const d of v.dims[side]) {
        const at = [v.along(d.dir, d.lo), v.along(d.dir, d.hi)];
        const offset = DIM_FIRST + d.level * DIM_STEP;
        const line = side === "top" ? box.y1 + offset : side === "bottom" ? box.y0 - offset : side === "right" ? box.x1 + offset : box.x0 - offset;
        const outward = side === "top" || side === "right" ? 1 : -1;
        const point = (along, across) => (d.dir === "h" ? [along, across] : [across, along]);
        for (const pos of at) {
          const start = extreme(lines.filter((l) => !l.hidden), d.dir, pos, outward)
            ?? extreme(lines.filter((l) => l.hidden), d.dir, pos, outward)
            ?? extreme(centres, d.dir, pos, outward)
            ?? (d.dir === "h" ? (outward > 0 ? box.y1 : box.y0) : (outward > 0 ? box.x1 : box.x0));
          seg(out.thin, point(pos, start + outward * 1.5), point(pos, line + outward * 2));
        }
        const [p, q] = at;
        if (!d.outside) {
          seg(out.thin, point(p, line), point(q, line));
          out.arrows.push([point(p, line), d.dir === "h" ? [-1, 0] : [0, -1]], [point(q, line), d.dir === "h" ? [1, 0] : [0, 1]]);
        } else {
          seg(out.thin, point(p - ARROW - 2, line), point(q + ARROW + 2, line));
          out.arrows.push([point(p, line), d.dir === "h" ? [1, 0] : [0, 1]], [point(q, line), d.dir === "h" ? [-1, 0] : [0, -1]]);
        }
        const textAt = d.textOutside ? q + (d.outside ? ARROW : 0) + 3 + textWidth(d.label) / 2 : (p + q) / 2;
        if (d.dir === "h") out.texts.push({ x: textAt, y: line + 1, text: d.label, anchor: "middle" });
        else out.texts.push({ x: line - 1, y: textAt, text: d.label, anchor: "middle", rotate: true });
      }
    }
    // The view's name, under it and its dimensions.
    const name = spec.titles?.[v.name] || VIEW_TITLE[v.name];
    out.texts.push({ x: v.x + v.w / 2, y: v.y - v.room.bottom + 3, text: name.toUpperCase(), anchor: "middle", size: 4, bold: true });
  }

  // Ø (or R) for each round face, in the view where it is a circle and
  // mostly visible; equal holes share one note ("2 × Ø10").
  const onPaperVisible = (v) => v.geo.pieces.filter((p) => !p.hidden).map((p) => (p.type === "seg" ? [p.a, p.b] : p.pts).map(v.paper));
  const visibleShare = ({ view, c, R }) => {
    const lines = onPaperVisible(view);
    let hit = 0;
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      const q = [c[0] + R * Math.cos(th), c[1] + R * Math.sin(th)];
      if (lines.some((pts) => pts.some((p, n) => n > 0 && distToSeg(q, pts[n - 1], p) < 0.15))) hit++;
    }
    return hit / 24;
  };
  const labelled = [];
  for (const rf of rounds) {
    if (rf.cone) continue; // a cone's sizes are given as dimensions
    const options = circles.filter((c) => c.rf === rf).map((c) => ({ ...c, share: visibleShare(c) })).sort((a, b) => b.share - a.share);
    const best = options[0];
    if (!best || best.share === 0) continue;
    const same = labelled.find((l) => l.view === best.view && l.rf.whole && rf.whole && Math.abs(l.rf.r - rf.r) < 1e-6 && l.rf.hole === rf.hole);
    if (same) { same.count++; continue; }
    labelled.push({ ...best, count: 1 });
  }
  for (const l of labelled) {
    const text = `${l.count > 1 ? `${l.count} × ` : ""}${l.rf.whole ? `Ø${fmt(l.rf.r * 2)}` : `R${fmt(l.rf.r)}`}`;
    leader(out, l, text, views);
  }

  // Everything drawn, then the sheet round it.
  const all = [...out.visible, ...out.hidden, ...out.centre, ...out.thin].flat();
  for (const t of out.texts) {
    const w = textWidth(t.text, t.size || FONT);
    if (t.rotate) all.push([t.x - (t.size || FONT), t.y - w / 2], [t.x, t.y + w / 2]);
    else all.push([t.x - w / 2, t.y], [t.x + w / 2, t.y + (t.size || FONT)]);
  }
  const bx0 = Math.min(...all.map((p) => p[0])) - 4;
  const bx1 = Math.max(...all.map((p) => p[0])) + 4;
  const by0 = Math.min(...all.map((p) => p[1])) - 4;
  const by1 = Math.max(...all.map((p) => p[1])) + 4;
  const cw = bx1 - bx0;
  const ch = by1 - by0;
  const [tbw, tbh] = TITLE_BLOCK;
  let sheet = null;
  let shift = null;
  for (const [label, W, H] of SHEETS) {
    const iw = W - MARGIN.left - MARGIN.right;
    const ih = H - MARGIN.top - MARGIN.bottom;
    if (cw <= iw && ch <= ih - tbh - 4) {
      sheet = { label, W, H };
      shift = [MARGIN.left + (iw - cw) / 2 - bx0, MARGIN.bottom + tbh + 4 + (ih - tbh - 4 - ch) / 2 - by0];
      break;
    }
    if (cw <= iw - tbw - 4 && ch <= ih) {
      sheet = { label, W, H };
      shift = [MARGIN.left + (iw - tbw - 4 - cw) / 2 - bx0, MARGIN.bottom + (ih - ch) / 2 - by0];
      break;
    }
  }
  if (!sheet) {
    const W = Math.ceil(cw + MARGIN.left + MARGIN.right);
    const H = Math.ceil(ch + MARGIN.top + MARGIN.bottom + tbh + 4);
    sheet = { label: "", W: Math.max(W, tbw + 40), H };
    shift = [MARGIN.left - bx0, MARGIN.bottom + tbh + 4 - by0];
  }

  const svg = renderSvg({ out, sheet, shift, spec, scaleLabel });
  const layout = views.map((v) => ({ name: v.name, x: v.x + shift[0], y: v.y + shift[1], w: v.w, h: v.h, pieces: v.geo.pieces }));
  return { svg, width: sheet.W, height: sheet.H, sheet: sheet.label, scale: scaleLabel, iso: drawIso(solid, edges), notes, views: layout };
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// The outermost point of the lines at a position along the paper (for an
// extension line's start), on the side the dimension is placed.
function extreme(lines, dir, pos, outward) {
  const along = (p) => (dir === "h" ? p[0] : p[1]);
  const across = (p) => (dir === "h" ? p[1] : p[0]);
  let best = null;
  const take = (v) => { if (best === null || (outward > 0 ? v > best : v < best)) best = v; };
  for (const { pts } of lines) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const da = along(a) - pos;
      const db = along(b) - pos;
      if (Math.abs(da) < 0.05 && Math.abs(db) < 0.05) { take(across(a)); take(across(b)); continue; }
      if (da * db <= 0 && da !== db) take(across(a) + (across(b) - across(a)) * (da / (da - db)));
    }
  }
  return best;
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const textBox = (t) => {
  const size = t.size || FONT;
  const w = textWidth(t.text, size);
  if (t.rotate) return [t.x - size, t.y - w / 2, t.x, t.y + w / 2];
  const x0 = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - w : t.x - w / 2;
  return [x0, t.y - 0.4, x0 + w, t.y + size];
};
const boxesMeet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function segMeetsBox(a, b, box) {
  const inside = (p) => p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3];
  if (inside(a) || inside(b)) return true;
  const c = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
  return c.some((p, i) => segsCross(a, b, p, c[(i + 1) % 4]));
}

// A leader for a hole or arc: an arrow on the circle pointing at the
// centre, a sloping line out, a short shoulder and the note — turned the way
// that crosses the fewest lines and covers no other writing.
function leader(out, { rf, view, c, R }, text, views) {
  const segs = [
    ...views.flatMap((v) => v.geo.pieces.map((p) => (p.type === "seg" ? [p.a, p.b] : p.pts).map(v.paper))),
    ...out.thin,
  ].flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p]));
  const texts = out.texts.map(textBox);
  // Directions on the paper, each with a small cost for straying from the
  // best spot (an arc's middle).
  let options = [45, 135, -45, -135, 30, 150, -30, -150, 60, 120, -60, -120].map((deg, i) => ({ th: (deg * Math.PI) / 180, cost: i * 0.01 }));
  if (!rf.whole && rf.arc) {
    const [j, kk] = rf.axis === 0 ? [1, 2] : rf.axis === 1 ? [0, 2] : [0, 1];
    const [a0, a1] = rf.arc;
    const mid = (a0 + a1) / 2;
    options = [];
    for (let n = 0; n <= 12; n++) {
      const th3 = a0 + ((a1 - a0) * (n + 0.5)) / 13;
      const p = [0, 0, 0];
      p[rf.axis] = rf.from;
      p[j] = rf.center[0] + rf.r * Math.cos(th3);
      p[kk] = rf.center[1] + rf.r * Math.sin(th3);
      const q = view.paper(view.geo.project(p));
      options.push({ th: Math.atan2(q[1] - c[1], q[0] - c[0]), cost: Math.abs(th3 - mid) * 0.2 });
    }
  }
  const w = textWidth(text);
  let best = null;
  for (const { th, cost: base } of options) {
    for (const reach of [10, 16]) {
      const u = [Math.cos(th), Math.sin(th)];
      const tip = [c[0] + u[0] * R, c[1] + u[1] * R];
      const elbow = [c[0] + u[0] * (R + reach), c[1] + u[1] * (R + reach)];
      const dirX = u[0] >= 0 ? 1 : -1;
      const end = [elbow[0] + dirX * (w + 2), elbow[1]];
      const note = { x: dirX > 0 ? elbow[0] + 1 : end[0] + 1, y: elbow[1] + 1, text, anchor: "start" };
      const box = textBox(note);
      let cost = base + (reach > 10 ? 0.5 : 0);
      for (const [a, b] of segs) {
        if (segsCross(tip, elbow, a, b) || segsCross(elbow, end, a, b)) cost += 1;
        if (segMeetsBox(a, b, box)) cost += 2;
      }
      const room = [box[0] - 1.5, box[1] - 1.5, box[2] + 1.5, box[3] + 1.5]; // clear of other writing
      for (const t of texts) {
        if (boxesMeet(t, room)) cost += 10;
        if (segMeetsBox(tip, elbow, t) || segMeetsBox(elbow, end, t)) cost += 4;
      }
      if (!best || cost < best.cost) best = { cost, u, tip, elbow, end, note };
    }
  }
  const { u, tip, elbow, end, note } = best;
  out.thin.push([tip, elbow], [elbow, end]);
  out.arrows.push([tip, [-u[0], -u[1]]]);
  out.texts.push(note);
}

// ---------- SVG ----------

const pathOf = (pts, Y) => `M${pts.map((p) => `${r2(p[0])} ${r2(Y(p[1]))}`).join("L")}`;

function projectionSymbol(x, y, angle) {
  // A truncated cone: its front view (a trapezoid, the small end left) and
  // its end view (two circles) — right of it for first angle, left for third.
  const h1 = 2.5;
  const h2 = 5;
  const w = 9;
  const parts = [];
  const tx = angle === "first" ? x : x + 15;
  const cx = angle === "first" ? x + w + 9 : x + 5;
  parts.push(`<path d="M${tx} ${y - h1}L${tx + w} ${y - h2}L${tx + w} ${y + h2}L${tx} ${y + h1}Z" fill="none" stroke="#000" stroke-width="0.35"/>`);
  parts.push(`<circle cx="${cx}" cy="${y}" r="${h2}" fill="none" stroke="#000" stroke-width="0.35"/>`);
  parts.push(`<circle cx="${cx}" cy="${y}" r="${h1}" fill="none" stroke="#000" stroke-width="0.35"/>`);
  const chain = 'stroke="#000" stroke-width="0.18" stroke-dasharray="3 0.8 0.8 0.8"';
  parts.push(`<path d="M${tx - 2} ${y}H${tx + w + 2}M${cx - h2 - 2} ${y}H${cx + h2 + 2}M${cx} ${y - h2 - 2}V${y + h2 + 2}" ${chain}/>`);
  return parts.join("");
}

function renderSvg({ out, sheet, shift, spec, scaleLabel }) {
  const { W, H } = sheet;
  const Y = (y) => H - y;
  const mv = (p) => [p[0] + shift[0], p[1] + shift[1]];
  const paths = (list) => list.map((pts) => `<path d="${pathOf(pts.map(mv), Y)}"/>`).join("");
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="Arial, Helvetica, sans-serif" role="img"><title>${esc(spec.title)}</title>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${W - MARGIN.left - MARGIN.right}" height="${H - MARGIN.top - MARGIN.bottom}" fill="none" stroke="#000" stroke-width="0.7"/>`);
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.25" stroke-linecap="round">${paths(out.thin)}</g>`);
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="12 2 2 2">${paths(out.centre)}</g>`);
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.35" stroke-dasharray="3 1.5">${paths(out.hidden)}</g>`);
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round">${paths(out.visible)}</g>`);
  const arrows = out.arrows.map(([tip, u]) => {
    const t = mv(tip);
    const n = [-u[1], u[0]];
    const base = [t[0] - u[0] * ARROW, t[1] - u[1] * ARROW];
    const pts = [t, [base[0] + n[0] * 0.55, base[1] + n[1] * 0.55], [base[0] - n[0] * 0.55, base[1] - n[1] * 0.55]];
    return `<path d="${pathOf(pts, Y)}Z"/>`;
  });
  parts.push(`<g fill="#000" stroke="none">${arrows.join("")}</g>`);
  const texts = out.texts.map((t) => {
    const [x, y] = mv([t.x, t.y]);
    const size = t.size || FONT;
    const attrs = `font-size="${size}"${t.bold ? ' font-weight="700"' : ""} text-anchor="${t.anchor || "middle"}"`;
    if (t.rotate) return `<text ${attrs} transform="translate(${r2(x)} ${r2(Y(y))}) rotate(-90)">${esc(t.text)}</text>`;
    return `<text x="${r2(x)}" y="${r2(Y(y))}" ${attrs}>${esc(t.text)}</text>`;
  });
  parts.push(`<g fill="#000">${texts.join("")}</g>`);
  parts.push(titleBlock(W, H, spec, scaleLabel));
  parts.push("</svg>");
  return parts.join("");
}

function titleBlock(W, H, spec, scaleLabel) {
  const [w, h] = TITLE_BLOCK;
  const x = W - MARGIN.right - w;
  const y = H - MARGIN.bottom - h; // SVG y of its top
  const row1 = 14;
  const row2 = 11;
  const line = (x1, y1, x2, y2) => `<path d="M${r2(x1)} ${r2(y1)}L${r2(x2)} ${r2(y2)}"/>`;
  const label = (lx, ly, t) => `<text x="${r2(lx)}" y="${r2(ly)}" font-size="2.2" fill="#444">${esc(t)}</text>`;
  const value = (lx, ly, t, size = 3.5, anchor = "start", bold = false) => `<text x="${r2(lx)}" y="${r2(ly)}" font-size="${size}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ""}>${esc(t)}</text>`;
  const angle = spec.projection === "third" ? "third" : "first";
  const parts = [];
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.5"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`);
  parts.push(`<g fill="none" stroke="#000" stroke-width="0.3">${[
    line(x, y + row1, x + w, y + row1),
    line(x, y + row1 + row2, x + 112, y + row1 + row2),
    line(x + 40, y + row1, x + 40, y + h),
    line(x + 78, y + row1, x + 78, y + row1 + row2),
    line(x + 112, y + row1, x + 112, y + h),
  ].join("")}</g>`);
  const title = spec.title.toUpperCase();
  const size = Math.min(6, (w - 8) / (title.length * 0.62));
  parts.push(`<g fill="#000">`);
  parts.push(value(x + w / 2, y + row1 / 2 + size * 0.36, title, size, "middle", true));
  parts.push(label(x + 2, y + row1 + 3, "SCALE"));
  parts.push(value(x + 2, y + row1 + 8.5, scaleLabel || "1:1"));
  parts.push(label(x + 42, y + row1 + 3, "UNITS"));
  parts.push(value(x + 42, y + row1 + 8.5, "mm"));
  parts.push(label(x + 80, y + row1 + 3, "MATERIAL"));
  parts.push(value(x + 80, y + row1 + 8.5, spec.material || "—", 3));
  parts.push(label(x + 2, y + row1 + row2 + 3, "NAME"));
  parts.push(label(x + 42, y + row1 + row2 + 3, "ROLL NO."));
  parts.push(label(x + 80, y + row1 + row2 + 3, "DATE"));
  parts.push(value(x + 131, y + row1 + 3.6, angle === "first" ? "FIRST ANGLE" : "THIRD ANGLE", 2.4, "middle", true));
  parts.push(value(x + 131, y + row1 + 6.6, "PROJECTION", 2.4, "middle", true));
  parts.push(`</g>`);
  parts.push(projectionSymbol(x + 117, y + row1 + 14.5, angle));
  return parts.join("");
}

// A small pictorial (isometric) view of the solid as read, visible edges
// only, for checking the model understood the object.
function drawIso(solid, edges) {
  const geo = drawView(solid, edges, "iso");
  const lines = geo.pieces.filter((p) => !p.hidden).map((p) => (p.type === "seg" ? [p.a, p.b] : p.pts));
  if (!lines.length) return "";
  const pts = lines.flat();
  const x0 = Math.min(...pts.map((p) => p[0]));
  const x1 = Math.max(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1]));
  const y1 = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  const w = x1 - x0 + pad * 2;
  const h = y1 - y0 + pad * 2;
  const sw = Math.max(w, h) / 220;
  const d = lines.map((l) => `M${l.map((p) => `${r2(p[0] - x0 + pad)} ${r2(y1 + pad - p[1])}`).join("L")}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" role="img"><title>The object as read</title><path d="${d}" fill="none" stroke="#1f1e1d" stroke-width="${r2(sw * 1.4) || 0.5}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
