const test = require("node:test");
const assert = require("node:assert/strict");

// The research itself is tested in agenticSearch.test.js. Here it is replaced
// (this file runs in its own process) to test what the chat and /api/research
// do with it.
const servicePath = require.resolve("../src/services/agenticSearchService");
const researchCalls = [];
const SOURCES = Array.from({ length: 15 }, (_, i) => ({ title: `Source ${i + 1}`, url: `https://s${i + 1}.test/page`, published: i === 0 ? "2026-09-01" : null }));
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    performAgenticSearch: async (query, opts) => {
      researchCalls.push({ query, opts });
      opts.onStatus?.("Planning the research…");
      opts.onProgress?.({ phase: "planning", angles: [], steps: [{ id: "plan", label: "Planning the research", detail: "", status: "active" }], sources: 0, pagesRead: 0, queries: 0, elapsedMs: 5 });
      opts.onProgress?.({
        phase: "writing",
        angles: ["Angle A", "Angle B"],
        steps: [
          { id: "plan", label: "Planning the research", detail: "2 angles to research", status: "done" },
          { id: "search-0", label: "Searching 2 angles", detail: "", status: "done" },
          { id: "write", label: "Writing the report", detail: "15 sources", status: "active" },
        ],
        sources: 15,
        pagesRead: 12,
        queries: 9,
        elapsedMs: 900,
      });
      return { context: "RESEARCH CONTEXT with [1] … [15]", compactContext: "COMPACT CONTEXT with [1] … [15]", results: SOURCES, rounds: 2, queries: ["q1", "q2"], angles: ["Angle A", "Angle B"], claims: [] };
    },
  },
};

const { config } = require("../src/config/env");
const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");

const events = (written) => written.join("").split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
const streamOf = (lines) => (async function* () { for (const line of lines) yield `${line}\n`; })();

function withProviders(t, adapters) {
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  const names = Object.keys(adapters);
  patch(providerManager, "getBestProvider", () => names[0]);
  patch(providerManager, "getAdapter", (name) => adapters[name]);
  patch(providerManager, "getAvailableProviders", () => names);
  patch(providerManager, "isConfigured", (name) => name in adapters);
  patch(providerManager, "updateMetrics", () => {});
  patch(providerManager, "suspendProvider", () => {});
  patch(orchestrator, "nextFallback", (failed, attempted) => names.find((n) => !attempted.has(n)) || null);
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });
}

const HISTORY = [
  { role: "user", content: "Tell me about renewable energy in India" },
  { role: "assistant", content: "India has expanded solar and wind quickly." },
  { role: "user", content: "How do solar and wind costs compare in 2026?" },
];

test("DeepSearch streams the research log, every source in citation order, and a full report brief to the writer", async (t) => {
  researchCalls.length = 0;
  let writer = null;
  withProviders(t, {
    writerModel: {
      generateStream: async (messages, options) => {
        writer = { messages, options };
        return streamOf(['data: {"choices":[{"delta":{"content":"Solar is cheaper [1][3]."}}]}']);
      },
    },
  });

  const written = [];
  const res = { write: (c) => written.push(c), end: () => {}, writableEnded: false };
  const answered = await orchestrator.processRequest("t_deep", {
    messages: HISTORY, mode: "deep_search", effort: "deep", options: { temperature: 0.7, maxTokens: 2048 },
  }, res);
  assert.equal(answered, true);

  // The research got the question, the conversation and its time budget.
  assert.equal(researchCalls.length, 1);
  assert.equal(researchCalls[0].query, HISTORY[2].content);
  assert.match(researchCalls[0].opts.history, /^User: Tell me about renewable energy in India\nAssistant: India has expanded/);
  assert.doesNotMatch(researchCalls[0].opts.history, /How do solar and wind/, "the question itself isn't history");
  assert.equal(researchCalls[0].opts.deadlineMs, orchestrator.RESEARCH_DEADLINE_MS);

  const evs = events(written);
  const research = evs.filter((e) => e.type === "research").map((e) => e.data);
  assert.equal(research.length, 3, "two from the research, one when the report is done");
  assert.equal(research.at(-1).phase, "done");
  assert.deepEqual(research.at(-1).steps.map((s) => s.status), ["done", "done", "done"]);
  assert.ok(evs.some((e) => e.type === "status" && e.data === "Planning the research…"));

  const sources = evs.find((e) => e.type === "sources").data;
  assert.equal(sources.length, 15, "all of them, not the first ten");
  assert.deepEqual(sources.map((s) => s.url), SOURCES.map((s) => s.url));
  assert.equal(sources[0].domain, "s1.test");
  assert.equal(sources[0].published, "2026-09-01");
  assert.ok(evs.findIndex((e) => e.type === "sources") < evs.findIndex((e) => e.type === "content"));

  // The writer writes a report from the research, with room to do it.
  const system = writer.messages[0].content;
  assert.match(system, /\[MODE: DEEP SEARCH — RESEARCH REPORT\]/);
  assert.match(system, /Confidence and gaps/);
  assert.match(system, /RESEARCH CONTEXT with \[1\] … \[15\]/);
  assert.ok(writer.options.maxTokens >= 8192);
  assert.equal(writer.options.effort, "deep");
  assert.doesNotMatch(system, /COMPACT CONTEXT/);
  assert.match(system, /RICH VISUALIZATION INTENT SYSTEM/, "a roomy writer keeps the full prompt");
});

test("Groq writes from the compact research, with a lean prompt that fits its request cap", async (t) => {
  const seen = {};
  withProviders(t, {
    groq: { generateStream: async (messages) => { seen.groq = messages[0].content; throw new Error("503 overloaded"); } },
    mistral: { generateStream: async (messages) => { seen.mistral = messages[0].content; return streamOf(['data: {"choices":[{"delta":{"content":"Report [1]."}}]}']); } },
  });
  const res = { write: () => {}, end: () => {}, writableEnded: false };
  await orchestrator.processRequest("t_groq", {
    messages: [{ role: "user", content: "How do solar and wind costs compare in 2026?" }], mode: "deep_search", options: { maxTokens: 2048 },
  }, res);

  assert.match(seen.groq, /COMPACT CONTEXT with \[1\] … \[15\]/);
  assert.doesNotMatch(seen.groq, /RESEARCH CONTEXT/);
  assert.doesNotMatch(seen.groq, /RICH VISUALIZATION INTENT SYSTEM/);
  assert.match(seen.groq, /RESEARCH REPORT/, "the report brief stays");
  assert.match(seen.mistral, /RESEARCH CONTEXT with \[1\] … \[15\]/, "the next writer gets everything again");

  // A realistic compact context (about 18k characters) still leaves Groq room to write.
  const { estimateTokens } = require("../src/providers/groqAdapter");
  const lean = await orchestrator.buildSystemPrompt("deep_search", { userQuery: "q", webContext: "x".repeat(18000), lean: true });
  assert.ok(estimateTokens([{ content: lean }]) + 3000 <= 11000, `${estimateTokens([{ content: lean }])} prompt tokens`);
});

test("when no model can write the report, the research log ends as failed", async (t) => {
  withProviders(t, { broken: { generateStream: async () => { throw new Error("401 unauthorized"); } } });
  const written = [];
  const res = { write: (c) => written.push(c), end: () => {}, writableEnded: false };
  const answered = await orchestrator.processRequest("t_fail", {
    messages: [{ role: "user", content: "How do solar and wind costs compare in 2026?" }],
    mode: "deep_search",
    options: { temperature: 0.7, maxTokens: 2048 },
  }, res);
  assert.equal(answered, false);
  const evs = events(written);
  const last = evs.filter((e) => e.type === "research").at(-1).data;
  assert.equal(last.phase, "failed");
  assert.ok(!last.steps.some((s) => s.status === "active"));
  assert.equal(last.steps.at(-1).status, "failed");
  assert.ok(evs.at(-1).type === "error");
});

test("POST /api/research streams the research, then the evidence and the report brief for a browser model", async (t) => {
  researchCalls.length = 0;
  config.groqApiKey = config.groqApiKey || "";
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;

  const missing = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missing.status, 400);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "How do solar and wind costs compare in 2026?", messages: HISTORY.slice(0, 2), clientTimeZone: "Asia/Kolkata" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const evs = events([await response.text()]);

  assert.deepEqual(evs.map((e) => e.type), ["status", "research", "research", "sources", "research_result"]);
  assert.equal(evs[3].data.length, 15);
  assert.equal(evs[4].data.context, "RESEARCH CONTEXT with [1] … [15]");
  assert.match(evs[4].data.instructions, /RESEARCH REPORT/);
  assert.match(researchCalls[0].opts.history, /Tell me about renewable energy in India/);
  assert.equal(researchCalls[0].opts.clock.timeZone, "Asia/Kolkata");
});
