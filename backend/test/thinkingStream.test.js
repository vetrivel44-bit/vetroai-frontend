const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// Collects the SSE events pipeStream writes, so each case can assert on the
// split between visible answer text and streamed reasoning.
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

async function* sseLines(lines) {
  for (const line of lines) yield Buffer.from(line);
}

const dataLine = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n`;
const joined = (events, type) => events.filter((e) => e.type === type).map((e) => e.data).join("");

test("native reasoning deltas stream separately from the answer", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    dataLine({ reasoning_content: "Check the " }),
    dataLine({ reasoning_content: "units first." }),
    dataLine({ content: "42 km" }),
  ]), res, "plugsky");

  assert.equal(joined(res.events, "reasoning"), "Check the units first.");
  assert.equal(joined(res.events, "content"), "42 km");
  assert.equal(res.events.filter((e) => e.type === "reasoning_start").length, 1);
  assert.equal(res.events.filter((e) => e.type === "reasoning_end").length, 1);
});

test("an inline <think> block is stripped from the answer even when its tags split across chunks", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    dataLine({ content: "<thi" }),
    dataLine({ content: "nk>step one" }),
    dataLine({ content: " step two</th" }),
    dataLine({ content: "ink>Answer: yes" }),
  ]), res, "plugsky");

  assert.equal(joined(res.events, "reasoning"), "step one step two");
  assert.equal(joined(res.events, "content"), "Answer: yes");
});

test("an unterminated <think> block never leaks into the answer", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([dataLine({ content: "<think>never closed" })]), res, "plugsky");

  assert.equal(joined(res.events, "reasoning"), "never closed");
  assert.equal(joined(res.events, "content"), "");
});

test("plain responses emit no reasoning events", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    dataLine({ content: "Hello " }),
    dataLine({ content: "world" }),
  ]), res, "groq");

  assert.equal(joined(res.events, "content"), "Hello world");
  assert.deepEqual(res.events.filter((e) => e.type.startsWith("reasoning")), []);
});

test("SDK object chunks carry reasoning through too", async () => {
  const res = makeRes();
  await orchestrator.pipeStream((async function* () {
    yield { choices: [{ delta: { reasoning: "weighing options" } }] };
    yield { choices: [{ delta: { content: "done" } }] };
  })(), res, "groq");

  assert.equal(joined(res.events, "reasoning"), "weighing options");
  assert.equal(joined(res.events, "content"), "done");
});

test("the thinking prompt scales with the requested effort", () => {
  assert.match(orchestrator.buildThinkingPrompt("quick"), /1-2 short sentences/);
  assert.match(orchestrator.buildThinkingPrompt("max"), /edge cases/);
  assert.match(orchestrator.buildThinkingPrompt(), /<think>/);
});

// ── SSE frame parsing ────────────────────────────────────────────────────────
// The space after "data:" is optional in the SSE spec; several OpenAI-compatible
// gateways omit it, and those frames used to be dropped entirely.
const compactDataLine = (delta) => `data:${JSON.stringify({ choices: [{ delta }] })}\n`;

test("frames written as data:{...} with no space are not dropped", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    compactDataLine({ content: "Hello " }),
    compactDataLine({ content: "world" }),
    "data:[DONE]\n",
  ]), res, "plugsky");

  assert.equal(joined(res.events, "content"), "Hello world");
});

test("compact frames carry reasoning deltas too", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    compactDataLine({ reasoning_content: "weighing options" }),
    compactDataLine({ content: "Answer" }),
  ]), res, "plugsky");

  assert.equal(joined(res.events, "reasoning"), "weighing options");
  assert.equal(joined(res.events, "content"), "Answer");
});

test("spaced and compact frames mix in one stream", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    dataLine({ content: "one " }),
    compactDataLine({ content: "two " }),
    dataLine({ content: "three" }),
    "data: [DONE]\n",
  ]), res, "groq");

  assert.equal(joined(res.events, "content"), "one two three");
});

test("a multi-byte character split across chunks is not lost", async () => {
  const res = makeRes();
  const payload = Buffer.from(dataLine({ content: "café ☕" }));
  // Cut inside the 3 bytes of "☕" so the decoder has to carry state across
  // chunks rather than emitting a replacement character.
  const cut = payload.indexOf(Buffer.from("☕")) + 1;
  await orchestrator.pipeStream(sseLines([
    payload.subarray(0, cut),
    payload.subarray(cut),
  ]), res, "plugsky");

  assert.equal(joined(res.events, "content"), "café ☕");
});

test("SSE comments and blank keep-alive lines produce no content", async () => {
  const res = makeRes();
  await orchestrator.pipeStream(sseLines([
    ": ping\n",
    "\n",
    dataLine({ content: "real text" }),
  ]), res, "plugsky");

  assert.equal(joined(res.events, "content"), "real text");
});
