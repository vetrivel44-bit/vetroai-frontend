import test from "node:test";
import assert from "node:assert/strict";

import { mergeLists } from "../src/lib/listMerge.js";

test("a chat deleted on one device does not come back from another's cache", () => {
  const remote = [{ id: "2", title: "kept" }];
  const local = [{ id: "1", title: "deleted on phone" }, { id: "2", title: "kept (old)" }, { id: "3", title: "made offline" }];
  const merged = mergeLists(remote, local, ["1"]);
  assert.deepEqual(merged.map((s) => s.id).sort(), ["2", "3"]);
  assert.equal(merged.find((s) => s.id === "2").title, "kept", "remote copy wins");
});

test("tombstones also remove items that are still in the cloud list", () => {
  assert.deepEqual(mergeLists([{ id: "9" }], [], ["9"]), []);
});
