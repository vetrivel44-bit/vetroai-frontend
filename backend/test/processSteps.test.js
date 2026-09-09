const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// The UI shows what VetroAI actually did for a turn — a lookup, a provider
// call, a fallback — instead of only a "thinking" spinner. That timeline is
// built entirely from `step` SSE events, so their shape is a contract.
function makeRes() {
  const events = [];
  return {
    events,
    write(payload) {
      const match = payload.match(/^data: (.*)\n\n$/);
      if (match) events.push(JSON.parse(match[1]));
    },
  };
}

const steps = (res) => res.events.filter((e) => e.type === "step").map((e) => e.data);

test("a step carries the fields the timeline renders", () => {
  const res = makeRes();
  orchestrator.sendStep(res, "search", "Read 3 web sources", "done", {
    ms: 1200,
    detail: "These pages were passed to the model as context.",
    items: [{ label: "Example", url: "https://example.com" }],
  });

  const [step] = steps(res);
  assert.equal(step.id, "search");
  assert.equal(step.label, "Read 3 web sources");
  assert.equal(step.state, "done");
  assert.equal(step.ms, 1200);
  assert.equal(step.items.length, 1);
  assert.equal(typeof step.ts, "number");
});

test("empty extras are left off the wire rather than sent as blanks", () => {
  const res = makeRes();
  orchestrator.sendStep(res, "analyze", "Analyzing your request");

  const [step] = steps(res);
  assert.equal(step.state, "running");
  assert.ok(!("detail" in step));
  assert.ok(!("items" in step));
  assert.ok(!("ms" in step));
});

test("a long source list is capped so one step cannot flood the panel", () => {
  const res = makeRes();
  const items = Array.from({ length: 20 }, (_, i) => ({ label: `Source ${i}`, url: `https://e.com/${i}` }));
  orchestrator.sendStep(res, "search", "Read 20 web sources", "done", { items });

  assert.equal(steps(res)[0].items.length, 8);
});

test("a step that resolves after the response ended is dropped, not written", () => {
  // The image lookup runs in parallel with everything else and can land after
  // a failed turn has already closed the stream.
  const res = makeRes();
  res.writableEnded = true;
  orchestrator.sendStep(res, "images", "Found 4 related images", "done");

  assert.equal(steps(res).length, 0);
});

test("a truncated answer is reported as its own step, not just a status line", async () => {
  const res = makeRes();
  const long = `${"word ".repeat(200)}\n\`\`\`js\nconst a = 1;`;
  await orchestrator.pipeStream(
    (async function* () { yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: long } }] })}\n`); })(),
    res,
    "plugsky"
  );

  const cutoff = steps(res).find((s) => s.id === "continue");
  assert.ok(cutoff, "the cut-off answer should appear in the timeline");
  assert.match(cutoff.detail, /continuation/i);
});
