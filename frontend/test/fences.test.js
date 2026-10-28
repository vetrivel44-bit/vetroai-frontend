import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFences } from "../src/lib/fences.js";
import { parseLooseJson } from "../src/lib/looseJson.js";

test("a fence glued to prose gets its own line, and so does the text after the closing fence", () => {
  const glued = 'Rainfall peaks from July through September.```chartjs\n{"type": "bar"}\n```Tamil Nadu stays hottest in May-June.';
  assert.equal(
    normalizeFences(glued),
    'Rainfall peaks from July through September.\n```chartjs\n{"type": "bar"}\n```\nTamil Nadu stays hottest in May-June.',
  );
});

test("well-formed fences are left alone", () => {
  const ok = "Text\n\n```python\nprint(1)\n```\n\nMore\n\n```mermaid\ngraph TD\n  A --> B\n```";
  assert.equal(normalizeFences(ok), ok);
  assert.equal(normalizeFences("no fences here"), "no fences here");
});

test("chart JSON with small slips is repaired instead of shown as code", () => {
  // A stray closing brace, as in the Tamil Nadu chart that failed with
  // "Unexpected token '}'".
  const stray = '{"type": "bar", "data": {"labels": ["Jan"], "datasets": [{"data": [24]}]}}}';
  assert.deepEqual(parseLooseJson(stray).data.labels, ["Jan"]);
  // Missing closers, a trailing comma, a comment.
  assert.equal(parseLooseJson('{"type": "line", "data": {"datasets": [{"data": [1, 2],}]').type, "line");
  assert.equal(parseLooseJson('{\n  // monthly\n  "a": 1\n}').a, 1);
  // Strings with brackets inside are left intact.
  assert.equal(parseLooseJson('{"t": "a } b ] c"}').t, "a } b ] c");
});

test("text that isn't JSON still fails", () => {
  assert.throws(() => parseLooseJson("not json at all"));
});
