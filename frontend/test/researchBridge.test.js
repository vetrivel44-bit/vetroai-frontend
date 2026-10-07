import test from "node:test";
import assert from "node:assert/strict";

// public/research-puter-bridge.js wraps window.fetch for DeepSearch: the
// backend's research first, Sonar Pro (through Puter) only when that fails
// before any of the report arrives. Loaded here against a stand-in window.

const encoder = new TextEncoder();
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
const sseResponse = (parts, init = {}) => new Response(new ReadableStream({
  start(controller) {
    for (const part of parts) controller.enqueue(encoder.encode(part));
    controller.close();
  },
}), { status: 200, headers: { "Content-Type": "text/event-stream" }, ...init });

let loads = 0;
async function loadBridge(backend, sonarReply = { message: { content: "Sonar's researched answer." }, citations: ["https://perplexity.test/source"] }) {
  const calls = { backend: [], sonar: [], announced: [] };
  const win = new EventTarget();
  win.fetch = async (input, init) => { calls.backend.push(String(input)); return backend(input, init); };
  win.puter = { ai: { chat: async (prompt, options) => { calls.sonar.push({ prompt, options }); return sonarReply; } } };
  win.whenPuter = async () => win.puter;
  win.addEventListener("vetroai:model-used", (event) => calls.announced.push(event.detail.label));
  globalThis.window = win;
  await import(`../public/research-puter-bridge.js?load=${++loads}`);
  return { fetch: win.fetch, calls };
}

const chatForm = (mode) => {
  const form = new FormData();
  form.append("mode", mode);
  form.append("input", "How do solar and wind costs compare in 2026?");
  form.append("messages", JSON.stringify([]));
  return form;
};

async function eventsOf(response) {
  return (await response.text())
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data:"))
    .map((chunk) => chunk.slice(5).trim())
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const RESEARCH = { type: "research", data: { phase: "searching", steps: [] } };

test("other chat modes and other requests are not touched", async () => {
  const original = sseResponse([frame({ type: "content", data: "hi" })]);
  const { fetch, calls } = await loadBridge(async () => original);
  assert.equal(await fetch("http://api.test/api/chat", { method: "POST", body: chatForm("normal") }), original);
  assert.equal(await fetch("http://api.test/api/research", { method: "POST", body: "{}" }), original);
  assert.equal(calls.sonar.length, 0);
});

test("DeepSearch goes to VetroAI's own research, streamed through untouched", async () => {
  const { fetch, calls } = await loadBridge(async () => sseResponse([
    frame(RESEARCH),
    frame({ type: "sources", data: [{ url: "https://a.test" }] }),
    ": ping\n\n",
    frame({ type: "content", data: "Solar is cheaper [1]." }),
    frame({ type: "research", data: { phase: "done", steps: [] } }),
  ]));
  const response = await fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") });
  const events = await eventsOf(response);
  assert.deepEqual(events.map((e) => e.type), ["research", "sources", "content", "research"]);
  assert.equal(calls.backend.length, 1);
  assert.equal(calls.sonar.length, 0);
  assert.deepEqual(calls.announced, []);
});

test("frames split across network chunks arrive whole", async () => {
  const whole = frame(RESEARCH) + frame({ type: "content", data: "Solar is cheaper." });
  const { fetch } = await loadBridge(async () => sseResponse([whole.slice(0, 7), whole.slice(7, 40), whole.slice(40)]));
  const events = await eventsOf(await fetch("http://api.test/api/chat", { method: "POST", body: chatForm("research") }));
  assert.deepEqual(events.map((e) => e.type), ["research", "content"]);
});

test("when the research ends in an error before any report, Sonar Pro answers on the same stream", async () => {
  const { fetch, calls } = await loadBridge(async () => sseResponse([
    frame(RESEARCH),
    frame({ type: "error", data: "All configured AI providers are currently unavailable." }),
  ]));
  const events = await eventsOf(await fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.deepEqual(events.map((e) => e.type), ["research", "clear", "research_reset", "sources", "status", "status", "sources", "content"]);
  assert.deepEqual(events[3].data, [], "the backend's sources are cleared");
  assert.match(events[4].data, /Sonar Pro instead/);
  assert.deepEqual(events[6].data, [{ title: "perplexity.test", url: "https://perplexity.test/source", domain: "perplexity.test", published: null }]);
  assert.match(events.at(-1).data, /Sonar's researched answer\.\n\n## Sources\n1\. https:\/\/perplexity\.test\/source/);
  assert.ok(!events.some((e) => e.type === "error"), "the backend's error is replaced by the answer");
  assert.equal(calls.sonar.length, 1);
  assert.equal(calls.sonar[0].options.model, "perplexity/sonar-pro");
  assert.match(calls.sonar[0].prompt, /How do solar and wind costs compare in 2026\?/);
  assert.deepEqual(calls.announced, ["Sonar Pro Research"]);
});

test("an unreachable or failing server also falls back to Sonar Pro", async () => {
  const unreachable = await loadBridge(async () => { throw new TypeError("Failed to fetch"); });
  let events = await eventsOf(await unreachable.fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.match(events.find((e) => e.type === "status").data, /can't be reached/);
  assert.equal(events.at(-1).type, "content");

  const failing = await loadBridge(async () => new Response("{}", { status: 503 }));
  events = await eventsOf(await failing.fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.match(events.find((e) => e.type === "status").data, /answered 503/);
  assert.equal(events.at(-1).type, "content");
});

test("errors the app handles itself, and errors after the report started, are passed through", async () => {
  const noVision = await loadBridge(async () => sseResponse([frame({ type: "error", data: "No image model.", code: "NO_VISION" })]));
  let events = await eventsOf(await noVision.fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.deepEqual(events, [{ type: "error", data: "No image model.", code: "NO_VISION" }]);
  assert.equal(noVision.calls.sonar.length, 0);

  const midway = await loadBridge(async () => sseResponse([frame({ type: "content", data: "Half a report" }), frame({ type: "error", data: "Stream stalled" })]));
  events = await eventsOf(await midway.fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.deepEqual(events.map((e) => e.type), ["content", "error"]);
  assert.equal(midway.calls.sonar.length, 0);
});

test("stopping the request stops it, with no fallback", async () => {
  const { fetch, calls } = await loadBridge(async () => { throw new DOMException("Aborted", "AbortError"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search"), signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.sonar.length, 0);
});

test("if Sonar Pro fails too, the user is told why", async () => {
  const { fetch } = await loadBridge(async () => sseResponse([frame({ type: "error", data: "providers down" })]), { message: { content: "" } });
  const events = await eventsOf(await fetch("http://api.test/api/chat", { method: "POST", body: chatForm("deep_search") }));
  assert.match(events.at(-1).data, /Research failed: Sonar Pro returned an empty research response/);
});
