import test from "node:test";
import assert from "node:assert/strict";

import { latexToText, normalizeMathDelimiters } from "../src/lib/math.js";
import { parseMarkdownBlocks, hasMath } from "../src/lib/documentExport.js";

test("LaTeX becomes readable text for places that can't render math", () => {
  assert.equal(latexToText(String.raw`x = \dfrac{-b\pm\sqrt{b^{2}-4ac}}{2a}`), "x = (−b±√(b²−4ac))/(2a)");
  assert.equal(latexToText(String.raw`E = E^{\circ} - \dfrac{0.0592}{n}\log Q`), "E = E° − 0.0592/n log Q");
  assert.equal(latexToText(String.raw`R = 8.314\ \text{J mol}^{-1}\text{K}^{-1}`), "R = 8.314 J mol⁻¹K⁻¹");
  assert.equal(latexToText(String.raw`\sin^{2}\theta + \cos^{2}\theta = 1`), "sin²θ + cos²θ = 1");
  assert.equal(latexToText(String.raw`\dfrac{x^{2}}{a^{2}}+\dfrac{y^{2}}{b^{2}}=1`), "x²/a²+y²/b²=1");
  assert.equal(latexToText(String.raw`AB\sin\theta`), "AB sin θ");
});

test("\\(..\\), \\[..\\] and bare [ .. ] lines become $ delimiters, code is left alone", () => {
  assert.equal(normalizeMathDelimiters(String.raw`Nernst: \(E = E^\circ\)`), "Nernst: $E = E^\\circ$");
  assert.equal(normalizeMathDelimiters(String.raw`\[ z = \frac{x}{y} \]`), "\n$$\nz = \\frac{x}{y}\n$$\n");
  assert.equal(normalizeMathDelimiters(String.raw`[ z = \frac{x - \text{mean}}{\text{std}} ]`), "$$\nz = \\frac{x - \\text{mean}}{\\text{std}}\n$$");
  assert.equal(normalizeMathDelimiters("`\\(x\\)` stays"), "`\\(x\\)` stays");
});

test("formulas in a document become math runs and blocks, with readable text alongside", () => {
  const blocks = parseMarkdownBlocks(String.raw`# Sheet

- Faraday: \(m = \dfrac{Q}{F}\)

\[ P = \binom{n}{k} \]`);
  const run = blocks[1].items[0].runs.find((r) => r.math);
  assert.equal(run.math, String.raw`m = \dfrac{Q}{F}`);
  assert.equal(run.text, "m = Q/F");
  const block = blocks.find((b) => b.type === "math");
  assert.equal(block.latex, String.raw`P = \binom{n}{k}`);
  assert.equal(hasMath(blocks), true);
  assert.equal(hasMath(parseMarkdownBlocks("# Plain\n\nNo formulas, just $5 and $10.")), false);
});
