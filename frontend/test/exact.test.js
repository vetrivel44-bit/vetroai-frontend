import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptics, renderOptics, solveOptics } from "../src/lib/exact/optics.js";
import { parseCircuit, renderCircuit } from "../src/lib/exact/circuit.js";
import { parseGeometry, renderGeometry } from "../src/lib/exact/geometry.js";
import { compileFormula, pretty, renderPlot } from "../src/lib/exact/plot.js";
import { parseMolecules } from "../src/lib/exact/molecule.js";

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const J = (o) => JSON.stringify(o);

test("ray diagrams: the image comes from the lens and mirror formulas", () => {
  const lens = (u) => solveOptics({ device: "convex lens", f: 10, u, h: 4 });
  assert.ok(near(lens(15).v, 30) && near(lens(15).m, -2) && lens(15).real, "between F and 2F: beyond 2F, magnified, inverted");
  assert.ok(near(lens(20).v, 20) && near(lens(20).m, -1), "at 2F: at 2F, same size");
  assert.ok(near(lens(5).v, -10) && near(lens(5).m, 2) && !lens(5).real, "inside F: virtual, erect, magnified");
  assert.ok(lens(10).atInfinity, "at F: image at infinity");
  const concaveLens = solveOptics({ device: "concave lens", f: 10, u: 20, h: 4 });
  assert.ok(near(concaveLens.v, -20 / 3) && near(concaveLens.m, 1 / 3) && !concaveLens.real);
  const mirror = solveOptics({ device: "concave mirror", f: 10, u: 30, h: 4 });
  assert.ok(near(mirror.v, 15) && near(mirror.m, -0.5) && mirror.real && near(mirror.x, -15), "real image in front");
  const convexMirror = solveOptics({ device: "convex mirror", f: 10, u: 20, h: 4 });
  assert.ok(near(convexMirror.v, -20 / 3) && !convexMirror.real && convexMirror.x > 0, "virtual, behind the mirror");
  const plane = solveOptics({ device: "plane mirror", f: 10, u: 12, h: 3 });
  assert.ok(near(plane.x, 12) && plane.m === 1);
});

test("ray diagrams: a named position stands for a distance", () => {
  assert.equal(parseOptics(J({ device: "Convex Lens", f: 10, position: "between F1 and 2F1" })).spec.u, 15);
  assert.equal(parseOptics(J({ device: "convex lens", f: 8, position: "beyond 2F" })).spec.u, 24);
  assert.equal(parseOptics(J({ device: "concave mirror", R: 20, position: "between C and F" })).spec.u, 15, "f = R/2");
  assert.equal(parseOptics(J({ device: "concave mirror", f: 10, position: "between F and P" })).spec.u, 5);
  assert.equal(parseOptics(J({ device: "convex lens", f: 10, position: "at infinity" })).spec.u, Infinity);
  assert.match(parseOptics(J({ device: "prism" })).error, /which lens or mirror/);
  const r = renderOptics(J({ device: "convex lens", f: 10, u: 15 }));
  assert.match(r.caption, /beyond 2F₂.*real, inverted, magnified \(m = −2\)/);
  for (const label of ["F₁", "F₂", "2F₁", "2F₂", "B′"]) assert.ok(r.svg.includes(label), label);
  assert.match(renderOptics(J({ device: "concave mirror", f: 10, position: "beyond C" })).caption, /between F and C.*real, inverted, diminished/);
  assert.match(renderOptics(J({ device: "convex mirror", f: 10, u: 20 })).caption, /virtual, erect, diminished/);
});

test("circuits: parts in series and in parallel, read however they're written", () => {
  const { spec } = parseCircuit(J({ circuit: [{ battery: "6 V" }, "key", ["parallel", { resistor: "R1 = 4 Ω" }, "voltmeter"], "Ammeter"] }));
  assert.deepEqual(spec.root.parts.map((p) => p.kind || p.group), ["battery", "key", "parallel", "ammeter"]);
  assert.equal(spec.root.parts[0].label, "6 V");
  assert.equal(spec.root.parts[2].parts[0].label, "R1 = 4 Ω");
  const alt = parseCircuit(J({ series: ["cell", { parallel: [{ type: "bulb", label: "L1" }, { type: "lamp", label: "L2" }] }] }));
  assert.equal(alt.spec.root.parts[1].group, "parallel");
  const r = renderCircuit(J({ title: "Two bulbs", circuit: ["cell", "switch", ["parallel", "bulb", "bulb"], "ammeter"] }));
  assert.equal((r.svg.match(/r="3.4"/g) || []).length, 2, "two junction dots where the branches split and meet");
  assert.ok(r.svg.includes(">A<"), "the ammeter's A");
  assert.match(parseCircuit(J({ circuit: ["unicorn"] })).error, /no parts/);
});

test("geometry: a triangle from its sides and angles is exact", () => {
  const sss = parseGeometry(J({ triangle: { name: "ABC", AB: 6, BC: 5, CA: 4 } })).spec.P;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  assert.ok(near(d(sss.A, sss.B), 6) && near(d(sss.B, sss.C), 5) && near(d(sss.C, sss.A), 4));
  const sas = parseGeometry(J({ triangle: { name: "PQR", PQ: 5, angleP: 90, PR: 3 } })).spec.P;
  assert.ok(near(d(sas.Q, sas.R), Math.sqrt(34)), "Pythagoras");
  const asa = parseGeometry(J({ triangle: { name: "ABC", AB: 7, angleA: 60, angleB: 60 } })).spec.P;
  assert.ok(near(d(asa.A, asa.C), 7) && near(d(asa.B, asa.C), 7), "equilateral");
  assert.match(parseGeometry(J({ triangle: { name: "ABC", AB: 1, BC: 2, CA: 5 } })).error, /No triangle/);
});

test("geometry: points from constructions", () => {
  const { P } = parseGeometry(J({
    points: { A: [0, 0], B: [8, 0], C: [2, 6], M: { mid: ["A", "B"] }, F: { foot: "C", on: ["A", "B"] }, D: { from: "A", toward: "B", turn: 90, dist: 3 },
      O: [0, 0], X: [5, 0], T: { tangentFrom: "X", circle: { center: "O", r: 3 } }, G: { centroid: ["A", "B", "C"] } },
  })).spec;
  assert.deepEqual(P.M, [4, 0]);
  assert.ok(near(P.F[0], 2) && near(P.F[1], 0));
  assert.ok(near(P.D[0], 0) && near(P.D[1], 3));
  assert.ok(near(Math.hypot(P.T[0], P.T[1]), 3) && near(Math.hypot(P.T[0] - 5, P.T[1]), 4), "a 3-4-5 tangent");
  assert.ok(near(P.G[0], 10 / 3) && near(P.G[1], 2));
  const fig = renderGeometry(J({ points: { O: [0, 0], X: [5, 0], T: { tangentFrom: "X", circle: { center: "O", r: 3 } } }, circles: [{ center: "O", r: 3 }], segments: ["OT", "XT"], angles: ["OTX"] }));
  assert.ok(fig.svg.includes("<circle"), "the circle");
  assert.match(fig.svg, /<path d="M[^"]+" stroke="#1f1e1d" stroke-width="1.5"/, "the right angle's square");
  assert.match(renderGeometry(J({ points: { A: [0, 0], B: [1, 0] }, segments: ["AZ"] })).error, /never places: Z/);
});

test("graphs: formulas are read safely and exactly", () => {
  const f = (s, x) => compileFormula(s)(x);
  assert.equal(f("x^2 - 4", 3), 5);
  assert.equal(f("y = 2x + 1", 2), 5);
  assert.equal(f("3(x+1)", 1), 6);
  assert.equal(f("x(x-1)", 3), 6);
  assert.ok(near(f("sin^2 x + cos^2 x", 0.7), 1));
  assert.equal(f("|x - 3|", 1), 2);
  assert.equal(f("2^x", 3), 8);
  assert.equal(f("−x²", 2), -4);
  assert.ok(near(f("xsinx", Math.PI / 2), Math.PI / 2));
  assert.ok(near(f("e^x", 1), Math.E));
  assert.ok(Number.isNaN(f("sqrt(x)", -1)));
  for (const bad of ["alert(1)", "constructor", "x;process.exit()", "window.x"]) assert.throws(() => compileFormula(bad), Error, bad);
  assert.equal(pretty("x^2 - 4"), "x² − 4");
  assert.equal(pretty("2*x + 1"), "2x + 1");
});

test("graphs: crossings, turning points and meetings are found", () => {
  const r = renderPlot(J({ functions: [{ y: "x^2 - 4" }, { y: "2x + 1" }], x: [-5, 5] }));
  const labels = r.features.map((p) => p.label);
  for (const want of ["(−2, 0)", "(2, 0)", "(0, −4)", "(−0.5, 0)", "(0, 1)", "(3.45, 7.9)", "(−1.45, −1.9)"]) assert.ok(labels.includes(want), want);
  assert.match(renderPlot(J({ functions: ["foo(x)"] })).error, /Couldn't read/);
});

test("structures: SMILES in any of the usual shapes", () => {
  assert.deepEqual(parseMolecules(J({ molecules: [{ name: "Ethanol", smiles: "CCO" }] })).spec.list, [{ smiles: "CCO", name: "Ethanol", condition: "" }]);
  assert.equal(parseMolecules("Benzene: c1ccccc1").spec.list[0].smiles, "c1ccccc1");
  const rxn = parseMolecules(J({ reactants: [{ smiles: "C=C" }], products: [{ smiles: "CCO" }] })).spec;
  assert.ok(rxn.arrows && rxn.list[1].arrow);
  assert.match(parseMolecules("<script>").error, /SMILES/);
});
