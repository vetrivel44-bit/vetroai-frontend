import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrthoSpec } from "../src/lib/ortho/spec.js";
import { buildSolid } from "../src/lib/ortho/solid.js";
import { drawView, findEdges } from "../src/lib/ortho/edges.js";
import { renderOrtho } from "../src/lib/ortho/index.js";

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const segs = (view, hidden) => view.pieces.filter((p) => p.type === "seg" && p.hidden === hidden);
// A straight line in a view, either way round.
const hasSeg = (view, a, b, hidden = false) => segs(view, hidden).some((s) =>
  (near(s.a[0], a[0]) && near(s.a[1], a[1]) && near(s.b[0], b[0]) && near(s.b[1], b[1]))
  || (near(s.a[0], b[0]) && near(s.a[1], b[1]) && near(s.b[0], a[0]) && near(s.b[1], a[1])));

function views(parts) {
  const { spec, error } = parseOrthoSpec(JSON.stringify({ parts }));
  assert.equal(error, undefined);
  const solid = buildSolid(spec.parts);
  const edges = findEdges(solid);
  return Object.fromEntries(["front", "top", "left", "right"].map((n) => [n, drawView(solid, edges, n)]));
}

// The machine block from a student's question: base, back wall, a sloping
// rib, a Ø24 hole through the wall and a slot at the front.
const MACHINE_BLOCK = {
  title: "Machine block", projection: "first", scale: "1:1", views: ["front", "top", "left"],
  parts: [
    { op: "add", name: "base", box: [0, 0, 0, 100, 15, 60] },
    { op: "add", name: "back wall", box: [0, 0, 45, 100, 65, 60] },
    { op: "add", name: "rib", prism: { axis: "x", from: 44, to: 56, points: [[15, 35], [15, 45], [50, 45]] } },
    { op: "cut", name: "hole", cylinder: { axis: "z", center: [50, 40], d: 24, from: 45, to: 60 } },
    { op: "cut", name: "slot", box: [35, 0, 0, 65, 15, 15] },
  ],
  dims: [{ view: "front", axis: "y", from: 0, to: 40 }, { view: "top", axis: "x", from: 35, to: 65 }],
};

test("the description is read however the model writes it", () => {
  const { spec } = parseOrthoSpec(`{"title":"Test","projection":"Third angle","scale":"1:2",
    "parts":[{"op":"union","box":{"from":[0,0,0],"to":[50,20,30]}},
      {"op":"subtract","cylinder":{"axis":"Y","centre":[25,10,15],"diameter":"10mm","from":20,"to":0}},
      {"type":"hole","cylinder":{"axis":"x","center":[10,15],"r":3,"from":0,"length":50}},
      {"op":"add","box":[1,2,3]}],
    "dims":[{"view":"side","axis":"z","between":[0,30]},{"view":"elevation","axis":"x","from":[0,0,0],"to":[50,0,0]}]}`);
  assert.equal(spec.projection, "third");
  assert.deepEqual(spec.scale, { label: "1:2", factor: 0.5 });
  assert.deepEqual(spec.views, ["front", "top", "right"], "third angle draws the right view");
  assert.equal(spec.parts.length, 3);
  assert.deepEqual(spec.parts[1], { op: "cut", name: "part 2", kind: "cylinder", axis: 1, center: [25, 15], r: 5, from: 0, to: 20 });
  assert.equal(spec.parts[2].op, "cut", "a hole is a cut");
  assert.equal(spec.parts[2].to, 50);
  assert.equal(spec.skipped.length, 1, "a box with three numbers is left out, not guessed");
  assert.deepEqual(spec.dims.map((d) => [d.view, d.axis, d.from, d.to]), [["side", 2, 0, 30], ["front", 0, 0, 50]]);
  assert.match(parseOrthoSpec("not json at all").error, /isn't readable/);
  assert.match(parseOrthoSpec('{"parts":[{"op":"cut","box":[0,0,0,1,1,1]}]}').error, /no parts|couldn't/);
});

test("a plain block: an outline in each view and nothing hidden", () => {
  const v = views([{ op: "add", box: [0, 0, 0, 40, 20, 30] }]);
  assert.equal(segs(v.front, false).length, 4);
  assert.equal(segs(v.front, true).length, 0);
  assert.ok(hasSeg(v.front, [0, 20], [40, 20]));
  assert.ok(hasSeg(v.top, [0, 30], [40, 30]), "the top view is 40 × 30");
  assert.ok(hasSeg(v.left, [-30, 0], [0, 0]), "the left view runs from the back (left) to the front (right)");
});

test("a hole through a plate: a circle where it is seen end-on, hidden lines across it", () => {
  const v = views([
    { op: "add", box: [0, 0, 0, 60, 40, 10] },
    { op: "cut", cylinder: { axis: "z", center: [30, 20], d: 16, from: 0, to: 10 } },
  ]);
  const circle = v.front.pieces.filter((p) => p.type === "poly" && !p.hidden);
  assert.ok(circle.length >= 1, "the hole is a visible circle in the front view");
  for (const p of circle.flatMap((c) => c.pts)) assert.ok(near(Math.hypot(p[0] - 30, p[1] - 20), 8, 0.01));
  assert.ok(hasSeg(v.top, [22, 0], [22, 10], true) && hasSeg(v.top, [38, 0], [38, 10], true), "hidden in the top view");
  assert.ok(hasSeg(v.left, [0, 12], [-10, 12], true) && hasSeg(v.left, [0, 28], [-10, 28], true), "hidden in the side view");
});

test("the machine block's views are exact", () => {
  const { spec } = parseOrthoSpec(JSON.stringify(MACHINE_BLOCK));
  const solid = buildSolid(spec.parts);
  const edges = findEdges(solid);
  const front = drawView(solid, edges, "front");
  const top = drawView(solid, edges, "top");
  const left = drawView(solid, edges, "left");
  // Front: the rib stands in front of the wall up to 50, the slot's sides,
  // the hole's circle — its part behind the rib dashed.
  assert.ok(hasSeg(front, [44, 15], [44, 50]) && hasSeg(front, [56, 15], [56, 50]));
  assert.ok(hasSeg(front, [44, 50], [56, 50]));
  assert.ok(hasSeg(front, [35, 0], [35, 15]) && hasSeg(front, [65, 0], [65, 15]));
  assert.ok(hasSeg(front, [0, 15], [100, 15]));
  const hiddenArc = front.pieces.filter((p) => p.type === "poly" && p.hidden).flatMap((p) => p.pts);
  assert.ok(hiddenArc.length && hiddenArc.every((p) => p[0] >= 43.9 && p[0] <= 56.1 && p[1] < 40), "only the arc behind the rib is hidden");
  // Top: the wall at the back (top of the view), the rib, the slot notch,
  // and the hole as hidden lines through the wall.
  assert.ok(hasSeg(top, [0, 45], [100, 45]));
  assert.ok(hasSeg(top, [44, 35], [56, 35]));
  assert.ok(hasSeg(top, [35, 15], [65, 15]) && hasSeg(top, [0, 0], [35, 0]) && hasSeg(top, [65, 0], [100, 0]));
  assert.ok(hasSeg(top, [38, 45], [38, 60], true) && hasSeg(top, [62, 45], [62, 60], true));
  // Side: the rib's slope, the slot and the hole hidden.
  assert.ok(hasSeg(left, [-45, 50], [-35, 15]));
  assert.ok(hasSeg(left, [-15, 0], [-15, 15], true));
  assert.ok(hasSeg(left, [-60, 28], [-45, 28], true) && hasSeg(left, [-60, 52], [-45, 52], true));
  assert.equal(segs(left, true).length, 3);
});

test("the sheet: first-angle layout, dimensions, title block and symbol", () => {
  const sheet = renderOrtho(JSON.stringify(MACHINE_BLOCK));
  assert.equal(sheet.error, undefined);
  const at = Object.fromEntries(sheet.views.map((v) => [v.name, v]));
  assert.ok(at.top.y + at.top.h < at.front.y, "first angle: the top view is below the front view");
  assert.ok(at.left.x > at.front.x + at.front.w, "the left view is drawn on the right");
  assert.ok(near(at.top.x, at.front.x) && near(at.left.y, at.front.y), "views line up");
  assert.equal(sheet.scale, "1:1");
  assert.equal(sheet.sheet, "A3");
  for (const text of ["MACHINE BLOCK", "FIRST ANGLE", "FRONT VIEW", "TOP VIEW", "LEFT SIDE VIEW", ">100<", ">65<", ">60<", ">40<", ">30<", ">Ø24<"]) {
    assert.ok(sheet.svg.includes(text), text);
  }
  assert.match(sheet.svg, /stroke-dasharray="3 1.5"/, "hidden lines are dashed");
  assert.match(sheet.svg, /stroke-dasharray="12 2 2 2"/, "centre lines are chain lines");
  assert.match(sheet.svg, /width="420mm" height="297mm"/, "prints true to scale");
  assert.match(sheet.iso, /^<svg/);

  const third = renderOrtho(JSON.stringify({ ...MACHINE_BLOCK, projection: "third", views: undefined }));
  const t = Object.fromEntries(third.views.map((v) => [v.name, v]));
  assert.ok(t.top.y > t.front.y + t.front.h, "third angle: the top view is above");
  assert.ok(t.right.x > t.front.x + t.front.w, "and the right view on the right");
  assert.ok(third.svg.includes("THIRD ANGLE"));
});

test("pyramids and cones", () => {
  const p = views([
    { op: "add", box: [0, 0, 0, 40, 30, 40] },
    { op: "add", pyramid: { axis: "y", from: 30, to: 70, points: [[0, 0], [40, 0], [40, 40], [0, 40]] } },
  ]);
  assert.ok(hasSeg(p.top, [0, 0], [40, 40]) && hasSeg(p.top, [0, 40], [40, 0]), "seen from above, the edges are the diagonals, through the apex");
  assert.ok(hasSeg(p.front, [0, 30], [20, 70]) && hasSeg(p.front, [40, 30], [20, 70]));
  const c = views([{ op: "add", cone: { axis: "y", center: [30, 30], d1: 60, d2: 0, from: 0, to: 50 } }]);
  assert.ok(hasSeg(c.front, [0, 0], [30, 50]) && hasSeg(c.front, [60, 0], [30, 50]), "a cone's outline is a triangle");
  assert.ok(c.top.pieces.some((x) => x.type === "poly" && !x.hidden), "and a circle from above");
});

test("a bad description says what is wrong instead of drawing nonsense", () => {
  assert.match(renderOrtho('{"parts":[]}').error, /no parts/);
  assert.match(renderOrtho("```").error, /readable/);
});
