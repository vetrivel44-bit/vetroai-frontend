import test from "node:test";
import assert from "node:assert/strict";

import { settleInterruptedTasks } from "../src/lib/computerTasks.js";

test("a task saved mid-run is stopped when Computer opens, so sending works again", () => {
  const [t, done] = settleInterruptedTasks([
    { id: "a", status: "running", steps: [{ id: "s", status: "active" }], messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "" }] },
    { id: "b", status: "completed", steps: [], messages: [{ role: "assistant", content: "ok" }] },
  ]);
  assert.equal(t.status, "stopped");
  assert.equal(t.steps[0].status, "pending");
  assert.match(t.messages[1].content, /page was closed/);
  assert.equal(done.status, "completed");
  const [r] = settleInterruptedTasks([{ status: "running", messages: [
    { role: "assistant", run: { status: "researching" } },
    { role: "assistant", folder: { status: "applying", ops: [{ from: "a", to: "b" }] } },
  ] }]);
  assert.equal(r.messages[0].run.status, "failed");
  assert.equal(r.messages[1].folder.status, "ready");
});
