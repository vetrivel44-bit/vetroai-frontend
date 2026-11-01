const test = require("node:test");
const assert = require("node:assert/strict");

// browseService itself is tested in browseService.test.js. Here its search
// and reading are replaced (this file runs in its own process) to test what
// the chat does with them for VetroAI Computer. Patched before the
// orchestrator loads, as it takes these functions when it is required.
const intent = require("../src/services/searchIntentService");
intent.decideSearch = async () => ({ search: true, by: "test" });

const browse = require("../src/services/browseService");
const browseCalls = [];
let browseResult = null;
browse.browseWeb = async (query, opts) => {
  browseCalls.push({ query, opts });
  opts.onEvent({ id: "search-0", kind: "search", query, status: "searching" });
  opts.onEvent({ id: "search-0", kind: "search", query, status: "done", found: 3 });
  opts.onEvent({ id: "page-0", kind: "visit", url: "https://reviews.test/pixel", domain: "reviews.test", title: "Pixel review", status: "loading" });
  opts.onEvent({ id: "page-0", kind: "visit", url: "https://reviews.test/pixel", domain: "reviews.test", title: "Pixel review", status: "read", excerpt: "The camera is sharper." });
  return browseResult;
};

const search = require("../src/controllers/searchController");
const plainSearches = [];
search.searchWeb = async (query) => { plainSearches.push(query); return { context: "PLAIN SEARCH CONTEXT", results: [{ title: "R", url: "https://r.test/" }] }; };

const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");

const events = (written) => written.join("").split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
const streamOf = (lines) => (async function* () { for (const line of lines) yield `${line}\n`; })();

function withWriter(t) {
  const seen = { system: null, question: null };
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  const writer = {
    generateStream: async (messages) => {
      seen.system = messages[0].content;
      seen.question = messages.filter((m) => m.role === "user").at(-1).content;
      return streamOf(['data: {"choices":[{"delta":{"content":"The camera is sharper [1]."}}]}']);
    },
  };
  patch(providerManager, "getBestProvider", () => "writerModel");
  patch(providerManager, "getAdapter", () => writer);
  patch(providerManager, "getAvailableProviders", () => ["writerModel"]);
  patch(providerManager, "isConfigured", (name) => name === "writerModel");
  patch(providerManager, "updateMetrics", () => {});
  patch(providerManager, "suspendProvider", () => {});
  patch(orchestrator, "nextFallback", () => null);
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });
  return seen;
}

const READ_CONTEXT = "VETROAI'S BROWSER FOR THIS TASK (1 Nov 2026)\n\nPAGES READ — the answer comes from these; cite them as [n]:\n\n[1] Pixel review — https://reviews.test/pixel\nThe camera is sharper.";

async function ask(t, messages, extra = {}) {
  const seen = withWriter(t);
  const written = [];
  const res = { write: (c) => written.push(c), end: () => {}, writableEnded: false };
  const answered = await orchestrator.processRequest("t_browse", {
    messages, mode: "code_exec", webSearch: true, options: { temperature: 0.7, maxTokens: 2048 }, ...extra,
  }, res);
  return { answered, evs: events(written), system: seen.system, question: seen.question };
}

test("a Computer task opens the pages it finds, streams each step and is answered from what was read", async (t) => {
  browseCalls.length = 0;
  plainSearches.length = 0;
  browseResult = { context: READ_CONTEXT, results: [{ url: "https://reviews.test/pixel", title: "Pixel review", published: "2026-10-01" }], pages: [] };
  const { answered, evs, system, question } = await ask(t, [
    { role: "user", content: "Find Pixel 10 Pro reviews on YouTube\n\n[USER-APPROVED CURRENT LOCATION] Latitude: 1, Longitude: 2." },
  ], { browse: true });
  assert.equal(answered, true);
  assert.equal(browseCalls.length, 1);
  assert.equal(browseCalls[0].query, "Find Pixel 10 Pro reviews on YouTube", "searched without Computer's notes");
  assert.deepEqual(plainSearches, [], "no snippet-only search");

  assert.ok(evs.some((e) => e.type === "status" && e.data === "Searching and opening pages..."));
  const steps = evs.filter((e) => e.type === "browse").map((e) => `${e.data.id}:${e.data.status}`);
  assert.deepEqual(steps, ["search-0:searching", "search-0:done", "page-0:loading", "page-0:read"]);
  const sources = evs.find((e) => e.type === "sources").data;
  assert.deepEqual(sources, [{ title: "Pixel review", url: "https://reviews.test/pixel", domain: "reviews.test", published: "2026-10-01" }]);
  assert.ok(evs.findIndex((e) => e.type === "browse") < evs.findIndex((e) => e.type === "content"));

  // What was read goes with the task (as every live search does); the rules
  // for answering from it go in the system prompt.
  assert.match(question, /^LIVE SEARCH RESULTS — fetched just now/);
  assert.match(question, /VETROAI'S BROWSER FOR THIS TASK/);
  assert.match(question, /\[1\] Pixel review — https:\/\/reviews\.test\/pixel/);
  assert.match(question, /My question: Find Pixel 10 Pro reviews on YouTube/);
  assert.match(system, /\[COMPUTER BROWSING — ANSWER FROM WHAT WAS READ\]/);
  assert.match(system, /listed under VETROAI'S BROWSER FOR THIS TASK \(given with the task\)/);
  assert.doesNotMatch(`${system}\n${question}`, /Quick Answer/);
});

test("a follow-up in the task is searched together with the task it follows", async (t) => {
  browseCalls.length = 0;
  browseResult = { context: READ_CONTEXT, results: [{ url: "https://reviews.test/pixel", title: "Pixel review" }], pages: [] };
  await ask(t, [
    { role: "user", content: "Find Pixel 10 Pro reviews on YouTube\n\n[ACTION RESULT] The desktop companion opened YouTube." },
    { role: "assistant", content: "Here is what the reviews say…" },
    { role: "user", content: "What about the battery?" },
  ], { browse: true });
  assert.equal(browseCalls.length, 1);
  assert.match(browseCalls[0].query, /^Find Pixel 10 Pro reviews on YouTube — What about the battery\?$/);
});

test("when no page could be read, the answer is told so, and the reader is warned", async (t) => {
  browseCalls.length = 0;
  browseResult = { context: "VETROAI'S BROWSER FOR THIS TASK\n\nPAGES READ: none. No page could be read for this task.\n\nOPENED BUT NOT READABLE — no content came from these; never cite or describe them:\n- youtube.com: YouTube asked to sign in to confirm it's not a bot", results: [], pages: [] };
  const { evs, system, question } = await ask(t, [{ role: "user", content: "Summarise the latest MKBHD video" }], { browse: true });
  assert.ok(evs.some((e) => e.type === "realtime_notice"));
  assert.equal(evs.filter((e) => e.type === "sources").length, 0);
  assert.match(question, /PAGES READ: none/);
  assert.match(question, /youtube\.com: YouTube asked to sign in/);
  assert.match(system, /\[COMPUTER BROWSING — ANSWER FROM WHAT WAS READ\]/);
  assert.match(system, /\[NO REAL-TIME DATA AVAILABLE\]/);
});

test("chat without the browse flag keeps its quick snippet search", async (t) => {
  browseCalls.length = 0;
  plainSearches.length = 0;
  const { system, question } = await ask(t, [{ role: "user", content: "Latest Pixel 10 Pro reviews" }], { mode: "normal" });
  assert.equal(browseCalls.length, 0);
  assert.equal(plainSearches.length, 1);
  assert.match(question, /PLAIN SEARCH CONTEXT/);
  assert.doesNotMatch(system, /COMPUTER BROWSING/);
});
