import test from "node:test";
import assert from "node:assert/strict";

import { styleConfig } from "../src/lib/chartStyle.js";

const cfg = (type, datasets, extra = {}) => ({ type, data: { labels: ["A", "B", "C"], datasets }, ...extra });

test("pie, doughnut and polar charts get one colour per slice and no x/y axes", () => {
  for (const type of ["pie", "doughnut", "polarArea"]) {
    const out = styleConfig(cfg(type, [{ label: "Share", data: [50, 30, 20] }]), "light");
    assert.equal(out.data.datasets[0].backgroundColor.length, 3, type);
    assert.equal(new Set(out.data.datasets[0].backgroundColor).size, 3, type);
    assert.equal(out.options.scales, undefined, type);
  }
});

test("radar charts style the round r axis, not x and y, and fill softly", () => {
  const out = styleConfig(cfg("radar", [{ label: "Phone A", data: [8, 6, 9] }]), "dark");
  assert.deepEqual(Object.keys(out.options.scales), ["r"]);
  assert.ok(out.options.scales.r.pointLabels.color);
  assert.ok(out.options.scales.r.angleLines.color);
  assert.match(out.data.datasets[0].backgroundColor, /33$/);
});

test("a line dataset on a bar chart is styled as a line (combo charts)", () => {
  const out = styleConfig(cfg("bar", [
    { label: "Sales", data: [10, 12, 15] },
    { label: "Growth %", data: [5, 20, 25], type: "line", yAxisID: "y1" },
  ], { options: { scales: { y1: { position: "right", title: { display: true, text: "%" } } } } }), "light");
  const [bar, line] = out.data.datasets;
  assert.match(bar.backgroundColor, /CC$/);
  assert.equal(bar.borderRadius, 6);
  assert.match(line.backgroundColor, /33$/);
  assert.equal(line.tension, 0.3);
  assert.ok(out.options.scales.y1.ticks.color);
  assert.ok(out.options.scales.y1.title.color);
  assert.equal(out.options.scales.y1.position, "right");
});

test("colours the model chose are kept", () => {
  const out = styleConfig(cfg("bar", [{ label: "X", data: [1, 2, 3], backgroundColor: "#123456" }]), "light");
  assert.equal(out.data.datasets[0].backgroundColor, "#123456");
});
