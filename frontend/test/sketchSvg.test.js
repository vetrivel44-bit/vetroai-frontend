import test from "node:test";
import assert from "node:assert/strict";
import { isInkColor, parseSketch } from "../src/lib/sketchSvg.js";

test("reads the shapes and labels of a sketch, in order", () => {
  const s = parseSketch(`<svg viewBox="0 0 400 300"><title>A house</title>
<rect x="80" y="140" width="240" height="140" fill="#f4d7a1" stroke="#222"/>
<polygon points="60,140 200,40 340,140" fill="#c0504d"/>
<path d="M 180 280 L 180 200 L 220 200 L 220 280"/>
<text x="200" y="295" text-anchor="middle">Door &amp; steps</text>
<circle cx="350" cy="50" r="20" fill="url(#sun)"/>
<line x1="0" y1="280" x2="400" y2="280"/>`);
  assert.deepEqual(s.viewBox, [0, 0, 400, 300]);
  assert.equal(s.title, "A house");
  assert.deepEqual(s.items.map((i) => i.tag), ["rect", "polygon", "path", "text", "circle", "line"]);
  assert.deepEqual(s.items[1].attrs.points, [[60, 140], [200, 40], [340, 140]]);
  assert.equal(s.items[3].text, "Door & steps");
  assert.equal(s.items[4].attrs.fill, undefined, "url() fills are dropped");
});

test("only whole elements are drawn while it streams, and nothing unsafe is kept", () => {
  const s = parseSketch('<svg viewBox="0 0 100 100"><rect x="1" y="1" width="10" height="10" onclick="alert(1)" fill="javascript:x"/><circle cx="5" cy="5" r="');
  assert.equal(s.items.length, 1);
  assert.deepEqual(s.items[0].attrs, { x: 1, y: 1, width: 10, height: 10 });
  assert.deepEqual(parseSketch("<script>alert(1)</script><image href='x'/>").items, []);
  assert.deepEqual(parseSketch("").viewBox, [0, 0, 400, 300]);
});

test("dark ink follows the theme", () => {
  assert.ok(isInkColor("#222") && isInkColor("#1a1a1a") && isInkColor("black") && isInkColor(undefined));
  assert.ok(!isInkColor("#c0504d") && !isInkColor("#f4d7a1") && !isInkColor("tomato"));
});

test("groups, rotations, arrows and multi-part labels — what textbook diagrams use", () => {
  const s = parseSketch(`<svg viewBox="0 0 300 200">
<g transform="translate(150 100)" fill="#f7a8c4" stroke="#222">
  <ellipse cx="0" cy="-40" rx="14" ry="34" transform="rotate(72)"/>
  <g transform="rotate(144)"><ellipse cx="0" cy="-40" rx="14" ry="34"/></g>
</g>
<line x1="20" y1="180" x2="120" y2="180" marker-end="url(#arrow)"/>
<path d="M 10 10 Q 50 50 90 10" class="ray arrow"/>
<text x="5" y="20">H<tspan baseline-shift="sub">2</tspan>O</text>
<rect x="0" y="0" width="10" height="10" transform="rotate(45) javascript:x"/>
<circle cx="1" cy="1" r="1" opacity="0.4"/>`);
  const [p1, p2, line, path, label, rect, dot] = s.items;
  assert.equal(p1.attrs.transform, "translate(150 100) rotate(72)");
  assert.equal(p1.attrs.fill, "#f7a8c4", "colour from the group");
  assert.equal(p2.attrs.transform, "translate(150 100) rotate(144)");
  assert.equal(line.attrs["marker-end"], "arrow");
  assert.equal(path.attrs["marker-end"], "arrow");
  assert.equal(label.text, "H2O");
  assert.equal(rect.attrs.transform, undefined, "anything but plain numbers is dropped");
  assert.equal(dot.attrs.opacity, 0.4);
});

test("a drawing can ask for a detailed version, once it is finished", () => {
  const live = parseSketch('<svg viewBox="0 0 400 300" detail="the human skull, side view"><title>Skull</title><circle cx="1" cy="1" r="1"/>');
  assert.equal(live.detail, "the human skull, side view");
  assert.equal(live.complete, false);
  assert.equal(parseSketch(`${'<svg detail="x<script>">'}</svg>`).detail, "");
  assert.equal(parseSketch('<svg viewBox="0 0 10 10"></svg>').complete, true);
});
