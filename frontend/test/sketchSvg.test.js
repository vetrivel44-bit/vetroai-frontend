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
