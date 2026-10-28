import test from "node:test";
import assert from "node:assert/strict";

import { isBlankCell } from "../src/lib/tableCells.js";

test("empty, whitespace-only and missing cells count as blank", () => {
  for (const c of [undefined, null, false, "", "   ", " ", [], ["", "  "], [null, " "]]) {
    assert.equal(isBlankCell(c), true, JSON.stringify(c));
  }
});

test("cells with text, numbers or elements are not blank", () => {
  for (const c of ["0", "—", "N/A", 0, ["", "x"], { type: "strong", props: {} }]) {
    assert.equal(isBlankCell(c), false, JSON.stringify(c));
  }
});
