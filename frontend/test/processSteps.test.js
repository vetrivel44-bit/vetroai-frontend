import test from "node:test";
import assert from "node:assert/strict";

import { mergeStep, settleSteps } from "../src/utils/processSteps.js";

test("a new step is appended in arrival order", () => {
  const steps = mergeStep(mergeStep([], { id: "analyze", label: "Analyzing", state: "running" }),
    { id: "search", label: "Searching the web", state: "running" });

  assert.deepEqual(steps.map((s) => s.id), ["analyze", "search"]);
});

test("a repeat of the same id updates that row in place instead of duplicating it", () => {
  let steps = mergeStep([], { id: "search", label: "Searching the web", state: "running" });
  steps = mergeStep(steps, { id: "model-1", label: "Asking Groq", state: "running" });
  steps = mergeStep(steps, { id: "search", label: "Read 3 web sources", state: "done", ms: 900 });

  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.id), ["search", "model-1"], "keeps its original position");
  assert.equal(steps[0].label, "Read 3 web sources");
  assert.equal(steps[0].state, "done");
  assert.equal(steps[0].ms, 900);
});

test("a fallback keeps the failed provider visible alongside the one that answered", () => {
  let steps = mergeStep([], { id: "model-1", label: "Asking Groq", state: "running" });
  steps = mergeStep(steps, { id: "model-1", label: "Groq failed", state: "failed" });
  steps = mergeStep(steps, { id: "model-2", label: "Re-routing to Mistral", state: "running" });
  steps = mergeStep(steps, { id: "model-2", label: "Mistral answered", state: "done" });

  assert.deepEqual(steps.map((s) => s.state), ["failed", "done"]);
});

test("an event without an id is ignored and does not force a re-render", () => {
  const steps = [{ id: "analyze", state: "done" }];

  assert.equal(mergeStep(steps, null), steps);
  assert.equal(mergeStep(steps, { label: "no id" }), steps);
});

test("a stream that dies mid-step leaves nothing spinning", () => {
  const steps = settleSteps([
    { id: "analyze", state: "done" },
    { id: "model-1", state: "running" },
  ]);

  assert.deepEqual(steps.map((s) => s.state), ["done", "done"]);
});

test("settling is a no-op when every step already finished", () => {
  const steps = [{ id: "analyze", state: "done" }, { id: "search", state: "failed" }];

  assert.equal(settleSteps(steps), steps, "same reference, so no wasted render");
});
