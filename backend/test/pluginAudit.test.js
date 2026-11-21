// Fixes from checking every plugin against a real model (see
// frontend/src/plugins/catalog.js): block formats every writer gets, the
// linked page that is read, room for models that think first, and the
// decider on AI Router's /v1/decisions.
const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const { pluginFormatPrompt } = require("../src/services/visualsPrompt");
const live = require("../src/services/pluginLiveService");
const decider = require("../src/services/deciderService");

test("plugins built on a block carry its exact format, for every writer", () => {
  const quiz = pluginFormatPrompt(["quiz-master"]);
  assert.match(quiz, /\[QUIZ\]/);
  assert.match(quiz, /quizzed now\. Don't offer a quiz or ask first/);
  assert.doesNotMatch(quiz, /After you teach or explain a study topic/, "the 'offer a quiz first' rule is left out");
  assert.match(quiz, /"answer": "B"/);
  assert.match(pluginFormatPrompt(["flashcard-maker"]), /```flashcards block holding strict JSON/);
  assert.match(pluginFormatPrompt(["slide-maker"]), /"layout"[\s\S]*"two-column"/);
  assert.match(pluginFormatPrompt(["maps"]), /```json map[\s\S]*"lat"/);
  const both = pluginFormatPrompt(["chart-maker", "data-analyst"]);
  assert.equal((both.match(/Chart rules/g) || []).length, 1, "the chart guide once");
  assert.equal(pluginFormatPrompt(["regex-lab", "mail-drafter"]), "", "plugins without a block add nothing");
});

test("Page & PDF Digest reads the linked page; a page it can't read is said, with no source shown", async () => {
  live.clearCache();
  const read = { readPage: async (url) => ({ status: "read", url, title: "UPI", text: "UPI is a real-time payment system. ".repeat(20) }) };
  const ok = await live.fetchLive("page", "summarise https://example.org/upi.", { deps: { pageReader: read } });
  assert.equal(ok.source, "https://example.org/upi", "trailing full stop isn't part of the link");
  assert.match(ok.lines.join("\n"), /real-time payment system/);
  assert.match(live.liveBlock(ok), /^LINKED PAGE — read for Page & PDF Digest/);

  live.clearCache();
  const blocked = { readPage: async (url) => ({ status: "blocked", url, reason: "the site refused automated visits (HTTP 403)" }) };
  const no = await live.fetchLive("page", "tldr https://example.org/paywalled", { deps: { pageReader: blocked } });
  assert.equal(no.source, null, "nothing was read, so no 'Read:' line");
  assert.match(no.lines[0], /couldn't be read: the site refused automated visits/);
  assert.match(no.lines[0], /Don't guess what it says/);

  live.clearCache();
  const none = await live.fetchLive("page", "summarise the attached pdf", { deps: { pageReader: read } });
  assert.equal(none.source, null);
  assert.match(none.lines[0], /No link in the message/);
});

test("the public live route doesn't fetch pages for anyone", async (t) => {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/plugins/live/page?q=https://example.org`);
  assert.equal(res.status, 404);
});

test("a model that thinks first and runs out of room is asked again with more, not dropped", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");
  const asked = [];
  const sse = (frames) => new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n").body;
  const adapter = {
    reasonsNatively: () => true,
    reasoningAlwaysOn: () => true,
    generateStream: async (messages, options) => {
      asked.push(options.maxTokens);
      return asked.length === 1
        ? sse([{ choices: [{ delta: { reasoning_content: "Let me think… ".repeat(50) } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }])
        : sse([{ choices: [{ delta: { content: "Here is the whole answer." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
    },
  };
  const saved = { getAdapter: providerManager.getAdapter, getAvailableProviders: providerManager.getAvailableProviders, getBestProvider: providerManager.getBestProvider, isConfigured: providerManager.isConfigured };
  Object.assign(providerManager, { getAdapter: () => adapter, getAvailableProviders: () => ["airouter"], getBestProvider: () => "airouter", isConfigured: () => true });
  t.after(() => Object.assign(providerManager, saved));

  const written = [];
  const res = { write: (c) => written.push(c), end() {}, writableEnded: false, locals: {} };
  const answered = await orchestrator.processRequest("room_test", {
    messages: [{ role: "user", content: "make a monthly budget" }], mode: "normal", options: { temperature: 0.5, maxTokens: 4096 },
  }, res);
  assert.equal(answered, true);
  assert.deepEqual(asked, [16384, 32768], "at least 16k to start with, then twice that");
  const events = written.join("");
  assert.match(events, /Here is the whole answer\./);
  assert.match(events, /Still thinking it through/);
  assert.doesNotMatch(events, /"type":"error"/);
});

test("the decider asks AI Router's /v1/decisions with typed questions", async (t) => {
  const saved = { key: config.airouterApiKey, fetch: global.fetch };
  config.airouterApiKey = "test-key";
  const sent = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), body });
    const q = body.questions[0];
    const answer = q.type === "predicate"
      ? { type: "predicate", name: q.name, probability: /ipl/i.test(body.input) ? 0.97 : 0.02 }
      : { type: "choice", name: q.name, choice: q.choices[1].value, confidence: 0.93 };
    return new Response(JSON.stringify({ answers: [answer] }), { status: 200 });
  };
  t.after(() => { config.airouterApiKey = saved.key; global.fetch = saved.fetch; });

  assert.equal(await decider.decideSearchIntent("who won the IPL final", [], "Saturday"), true);
  assert.equal(await decider.decideSearchIntent("hi there", [], ""), false);
  assert.equal(await decider.decideMode("fix my python", []), "analyst", "the chosen value comes back");
  assert.equal(await decider.decideEffort("weather"), "balanced");
  assert.equal(await decider.rewriteQuery("and his age?", ["User: who is the PM"], ""), null, "a decision model can't write a query");
  assert.ok(sent.every((s) => s.url === "https://api.airouter.in/v1/decisions"));
  assert.ok(sent.every((s) => s.body.model === "perplexity/pplx-decider-v1.3" && typeof s.body.input === "string"));
  const modeQ = sent.find((s) => s.body.questions[0].name === "mode").body.questions[0];
  assert.equal(modeQ.type, "choice");
  assert.deepEqual(modeQ.choices.map((c) => c.value), ["deep_search", "analyst", "debugger", "summarize", "web_search", "normal"]);
  assert.doesNotMatch(modeQ.instructions, /Reply with/, "chat-only wording is left off");
});
