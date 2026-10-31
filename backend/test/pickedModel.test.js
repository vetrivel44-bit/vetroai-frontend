const test = require("node:test");
const assert = require("node:assert/strict");

// A fixed live search result, set before the orchestrator is loaded (it takes
// searchWeb when it is required).
const searchController = require("../src/controllers/searchController");
const FRESH = "[1] Example Corp named Jane Doe its CEO on 2 October 2026 (example.com/news)";
let searches = 0;
searchController.searchWeb = async () => {
  searches++;
  return { context: `SOURCES:\n${FRESH}`, results: [{ title: "New CEO", url: "https://example.com/news", snippet: FRESH }] };
};

const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");
const groqAdapter = require("../src/providers/groqAdapter");

const say = (text) => (async function* () {
  yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;
  yield "data: [DONE]\n";
})();
const events = (written) => written.join("").split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
const shownAnswer = (evts) => {
  const last = evts.map((e) => e.type).lastIndexOf("clear");
  return evts.slice(last + 1).filter((e) => e.type === "content").map((e) => e.data).join("");
};

// Real ProviderManager (getBestProvider, pickedAlone, fallbacks), with only
// these providers configured and stub adapters behind them.
function withAdapters(t, adapters) {
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "isConfigured", (name) => name in adapters);
  patch(providerManager, "getAdapter", (name) => adapters[name]);
  patch(providerManager, "updateMetrics", () => {});
  for (const p of Object.values(providerManager.providers)) { p.isSuspended = false; p.consecutiveErrors = 0; }
  orchestrator.setPickedAloneRetryDelay(1);
  t.after(() => {
    for (const [target, name, fn] of originals.reverse()) target[name] = fn;
    for (const p of Object.values(providerManager.providers)) { p.isSuspended = false; p.consecutiveErrors = 0; }
    orchestrator.setPickedAloneRetryDelay(1000);
  });
}

async function ask(provider, input, extra = {}) {
  const written = [];
  const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false, locals: {} };
  const ok = await orchestrator.processRequest(`t_${Math.random()}`, {
    messages: [{ role: "user", content: input }], mode: "normal", provider, options: {}, ...extra,
  }, res);
  return { ok, events: events(written) };
}

test("a picked model that times out is tried again, never swapped for another model", async (t) => {
  const calls = [];
  withAdapters(t, {
    groq: { generateStream: async () => { calls.push("groq"); if (calls.length === 1) throw new Error("Stream generation timeout"); return say("Groq's answer."); } },
    airouter: { generateStream: async () => { calls.push("airouter"); return say("Someone else's answer."); } },
  });
  const r = await ask("Groq", "Explain how tides work");
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["groq", "groq"]);
  assert.equal(shownAnswer(r.events), "Groq's answer.");
  assert.ok(r.events.some((e) => e.type === "status" && /Groq timed out\. Trying Groq again/.test(e.data)));
});

test("Auto still moves on to another model when one times out", async (t) => {
  const calls = [];
  withAdapters(t, {
    groq: { generateStream: async () => { calls.push("groq"); throw new Error("Stream generation timeout"); } },
    airouter: { generateStream: async () => { calls.push("airouter"); return say("Fallback answer."); } },
  });
  const r = await ask("Auto", "Explain how tides work");
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["groq", "airouter"], "Groq is tried first in Auto, then the fallback");
  assert.equal(shownAnswer(r.events), "Fallback answer.");
});

test("Groq is first in Auto, except in design mode", (t) => {
  withAdapters(t, { groq: {}, airouter: {}, fable: {}, chatgpt: {}, gemini: {} });
  for (const mode of ["normal", "coding", "creative", "web_search", "deep_search", "analyst"]) {
    assert.equal(providerManager.getBestProvider(mode, "Auto"), "groq", mode);
  }
  assert.equal(providerManager.getBestProvider("design", "Auto"), "fable");
});

test("an answer that admits its knowledge is out of date is answered again with a web search", async (t) => {
  searches = 0;
  const sent = [];
  withAdapters(t, {
    groq: {
      searchResultsWithQuestion: groqAdapter.searchResultsWithQuestion,
      generateStream: async (messages) => {
        sent.push(messages);
        return say(sent.length === 1
          ? "As of my last update in 2024, the CEO of Example Corp was John Smith."
          : "Jane Doe has been Example Corp's CEO since 2 October 2026 [1].");
      },
    },
  });
  // Doesn't look like a live-info question, so nothing is searched up front.
  const r = await ask("Groq", "Which company makes the Zephyr X9 phone", { webSearch: "true" });
  assert.equal(r.ok, true);
  assert.equal(searches, 1, "searched once, after the out-of-date answer");
  assert.equal(sent.length, 2);
  assert.ok(r.events.some((e) => e.type === "clear"), "the out-of-date answer is cleared");
  assert.equal(shownAnswer(r.events), "Jane Doe has been Example Corp's CEO since 2 October 2026 [1].");

  // Groq gets the results with the question, under a lean system prompt.
  const [system, ...rest] = sent[1];
  const question = rest[rest.length - 1].content;
  assert.match(question, /^LIVE SEARCH RESULTS/);
  assert.ok(question.includes(FRESH));
  assert.match(question, /My question: Which company makes the Zephyr X9 phone$/);
  assert.doesNotMatch(system.content, /LIVE SEARCH RESULTS/);
});

test("with auto-search off, an out-of-date answer is left as it is", async (t) => {
  searches = 0;
  let calls = 0;
  withAdapters(t, { groq: { generateStream: async () => { calls++; return say("As of my last update in 2024, it was John Smith."); } } });
  const r = await ask("Groq", "Which company makes the Zephyr X9 phone", { webSearch: "false" });
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
  assert.equal(searches, 0);
});

test("out-of-date phrasing is recognised, ordinary answers are not", () => {
  for (const text of [
    "As of my last update in 2024, the price was $999.",
    "My knowledge cutoff is June 2024, so I can't say.",
    "I don't have access to real-time information.",
    "I do not have information about events after 2024.",
    "I'm unable to browse the internet.",
  ]) assert.equal(orchestrator.soundsOutOfDate(text), true, text);
  for (const text of [
    "Tides are caused by the Moon's gravity.",
    "Here is the latest version of your code.",
  ]) assert.equal(orchestrator.soundsOutOfDate(text), false, text);
});
