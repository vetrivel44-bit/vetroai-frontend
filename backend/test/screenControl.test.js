const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const gemini = require("../src/providers/geminiAdapter");
const orchestrator = require("../src/services/AIOrchestrator");

test("short thinking is asked for in the setting each Gemini family takes, and only when wanted", () => {
  assert.deepEqual(gemini.thinkingConfigFor("gemini-3.6-flash", "low"), { thinkingLevel: "low" });
  assert.deepEqual(gemini.thinkingConfigFor("models/gemini-3-pro-preview", "low"), { thinkingLevel: "low" });
  assert.deepEqual(gemini.thinkingConfigFor("gemini-2.5-flash", "low"), { thinkingBudget: 512 });
  assert.equal(gemini.thinkingConfigFor("gemini-2.0-flash", "low"), null, "a model without thinking gets no setting");
  assert.equal(gemini.thinkingConfigFor("gemini-3.6-flash", undefined), null, "other requests are left as they were");
});

function withFetch(responses, run) {
  const sent = [];
  const original = global.fetch;
  const savedKey = config.geminiApiKey;
  config.geminiApiKey = "test-key";
  global.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const next = responses.shift();
    return { ok: next.status === 200, status: next.status, body: "stream", text: async () => next.text || "" };
  };
  return run(sent).finally(() => { global.fetch = original; config.geminiApiKey = savedKey; });
}

test("a screen-control step asks Gemini for short thinking, and a model that refuses the setting answers without it", async () => {
  await withFetch([{ status: 200 }], async (sent) => {
    assert.equal(await gemini.generateStream([{ role: "user", content: "hi" }], { model: "gemini-3.6-flash", maxTokens: 1024, thinking: "low" }), "stream");
    assert.deepEqual(sent[0].generationConfig, { temperature: 0.7, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "low" } });
  });
  await withFetch([{ status: 400, text: "Thinking level is not supported for this model." }, { status: 200 }], async (sent) => {
    assert.equal(await gemini.generateStream([{ role: "user", content: "hi" }], { model: "gemini-3.6-flash", thinking: "low" }), "stream");
    assert.equal(sent.length, 2);
    assert.equal(sent[1].generationConfig.thinkingConfig, undefined);
  });
  await withFetch([{ status: 400, text: "API key not valid." }], async (sent) => {
    await assert.rejects(gemini.generateStream([{ role: "user", content: "hi" }], { model: "gemini-3.6-flash", thinking: "low" }), /400 API key not valid/);
    assert.equal(sent.length, 1, "other errors aren't retried");
  });
  await withFetch([{ status: 200 }], async (sent) => {
    await gemini.generateStream([{ role: "user", content: "hi" }], { model: "gemini-3.6-flash" });
    assert.equal(sent[0].generationConfig.thinkingConfig, undefined, "a normal chat turn is unchanged");
  });
});

test("the screen-control prompt points on the grid, reports success honestly, and acts on 'nothing changed'", async () => {
  const sys = await orchestrator.buildSystemPrompt("computer_use", { userQuery: "open notepad" });
  // The step message says which coordinates (app and server deploy separately).
  assert.match(sys, /coordinates the step message describes/);
  assert.match(sys, /"done": \{success: true\|false, summary\}/);
  assert.match(sys, /success true only when the screenshot you were just given shows the goal achieved/);
  assert.match(sys, /nothing on the screen changed/);
  assert.doesNotMatch(sys, /Coordinates are pixels/);
});

// A screen-control run is counted once when it starts. Counting each step as
// a chat message as well ended runs part-way: 40 steps are a free plan's
// whole 5-hour limit.
test("screen-control steps aren't counted as chat messages; ordinary chat still is", async (t) => {
  const usage = require("../src/services/usageService");
  const calls = { check: 0, record: 0 };
  const saved = { check: usage.check, record: usage.record, processRequest: orchestrator.processRequest };
  usage.check = async () => { calls.check++; return { allowed: true }; };
  usage.record = async () => { calls.record++; };
  orchestrator.processRequest = async (_id, _params, res) => { res.write(`data: ${JSON.stringify({ type: "content", data: "{}" })}\n\n`); return true; };
  t.after(() => { usage.check = saved.check; usage.record = saved.record; orchestrator.processRequest = saved.processRequest; });

  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const post = async (mode) => (await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "next step", mode, provider: "auto" }),
  })).text();

  await post("computer_use");
  await post("computer_use");
  assert.deepEqual(calls, { check: 0, record: 0 });
  await post("normal");
  assert.deepEqual(calls, { check: 1, record: 1 });
});

test("the screen agent is told the keys, shortcuts and waiting it can use", async () => {
  const prompt = await orchestrator.buildSystemPrompt("computer_use", { userQuery: "open a new tab", clock: {} });
  assert.match(prompt, /key is a letter A-Z, a digit 0-9, F1-F12/);
  assert.match(prompt, /CTRL\+L focuses the address bar; then "type" a web address, or words to search the web/);
  assert.match(prompt, /CTRL\+T opens a new tab/);
  assert.match(prompt, /ALT\+TAB switches to the last window/);
  assert.match(prompt, /"wait": \{seconds\}/);
  assert.match(prompt, /"scroll": \{amount, x, y \(optional\)\}/);
  assert.doesNotMatch(prompt, /a single letter A\/C\/V\/X\/Z/);
});
