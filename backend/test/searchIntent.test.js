const test = require("node:test");
const assert = require("node:assert/strict");

// A fixed live search, set before the orchestrator is loaded.
const searchController = require("../src/controllers/searchController");
let searches = 0;
searchController.searchWeb = async () => {
  searches++;
  return { context: "SOURCES:\n[1] Pharrell Williams – Happy (song, 2013)", results: [{ title: "Happy (song)", url: "https://example.com/happy", snippet: "Because I'm happy…" }] };
};

const intent = require("../src/services/searchIntentService");
const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");
const app = require("../src/app");

const say = (text) => (async function* () {
  yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;
  yield "data: [DONE]\n";
})();

function withJudge(t, decide) {
  const asked = [];
  intent.clearCache();
  intent.setModel(async (messages) => { asked.push(messages); return decide(messages); });
  t.after(() => { intent.setModel(async () => { throw new Error("no model in tests"); }); intent.clearCache(); });
  return asked;
}

function withGroq(t, generateStream) {
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "isConfigured", (name) => name === "groq");
  patch(providerManager, "getAdapter", () => ({ generateStream }));
  patch(providerManager, "updateMetrics", () => {});
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });
}

async function chat(input, extra = {}) {
  const written = [];
  const res = { write: (c) => written.push(c), end: () => {}, writableEnded: false, locals: {} };
  await orchestrator.processRequest(`t_${Math.random()}`, {
    messages: [{ role: "user", content: input }], mode: "normal", provider: "Groq", webSearch: "true", options: {}, ...extra,
  }, res);
  return written.join("");
}

test("\"I am happy\" is not searched when the judge says NO, even with auto-search on", async (t) => {
  searches = 0;
  const asked = withJudge(t, () => "NO");
  let prompt = null;
  withGroq(t, async (messages) => { prompt = messages; return say("That's great to hear! 😊"); });
  await chat("I am happy");
  assert.equal(searches, 0);
  assert.equal(asked.length, 1, "the judge was asked");
  assert.doesNotMatch(prompt[prompt.length - 1].content, /LIVE SEARCH RESULTS/);
});

test("a question the judge says needs current facts is searched", async (t) => {
  searches = 0;
  withJudge(t, () => "SEARCH");
  withGroq(t, async () => say("Here it is [1]."));
  await chat("rbi repo rate");
  assert.equal(searches, 1);
});

test("the judge sees today's date and the last turns, so a follow-up is understood", async (t) => {
  const asked = withJudge(t, () => "SEARCH");
  withGroq(t, async () => say("ok"));
  await chat("and in 2025?", {
    messages: [
      { role: "user", content: "who won the ipl in 2024" },
      { role: "assistant", content: "Kolkata Knight Riders won IPL 2024." },
      { role: "user", content: "and in 2025?" },
    ],
  });
  const [system, user] = asked[0];
  assert.match(system.content, /Today is /);
  assert.match(user.content, /User: who won the ipl in 2024/);
  assert.match(user.content, /Latest message: and in 2025\?$/);
});

test("if the judge fails or is slow, the word list decides", async (t) => {
  intent.clearCache();
  intent.setModel(async () => { throw new Error("rate limited"); });
  t.after(() => intent.setModel(async () => { throw new Error("no model in tests"); }));
  assert.deepEqual(await intent.decideSearch({ query: "iam happy" }), { search: false, by: "rules", reason: "rate limited" });
  assert.equal((await intent.decideSearch({ query: "rbi repo rate" })).search, true);
  intent.setModel(() => new Promise(() => {})); // never answers
  const started = Date.now();
  const slow = await intent.decideSearch({ query: "tamil nadu cm" });
  assert.equal(slow.by, "rules");
  assert.ok(Date.now() - started < intent.DECIDE_TIMEOUT_MS + 1000);
});

test("coding and writing modes skip the judge; a repeated message is asked once", async (t) => {
  const asked = withJudge(t, () => "SEARCH");
  assert.equal((await intent.decideSearch({ query: "best laptop for coding", mode: "debugger" })).by, "rules");
  assert.equal(asked.length, 0);
  await intent.decideSearch({ query: "petrol price chennai" });
  const again = await intent.decideSearch({ query: "Petrol price Chennai" });
  assert.equal(asked.length, 1);
  assert.equal(again.cached, true);
});

test("POST /api/search-intent gives browser models the same decision", async (t) => {
  withJudge(t, (messages) => (/happy/i.test(messages[1].content) ? "NO" : "SEARCH"));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const post = async (query) => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/search-intent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode: "normal", timeZone: "Asia/Kolkata" }),
  })).json()).data;
  assert.deepEqual(await post("I am happy"), { search: false, by: "model" });
  assert.deepEqual(await post("rbi repo rate"), { search: true, by: "model" });
});

// "Ur name" was searched with auto-search on, and the reply was about the
// ancient city of Ur. Questions to VetroAI about itself and small talk, in
// text-speak or not, never reach the judge or the web.
const ABOUT_ITSELF = ["Ur name", "ur name?", "wat is ur name", "who r u", "who are you", "which model r u", "r u chatgpt", "who made u", "ur creator", "how old r u", "tera naam kya hai", "un peru enna"];
const SMALL_TALK = ["how r u", "thank u so much", "ty bro", "r u there", "whats up", "u r smart", "gud mrng", "hmm ok"];

test("questions to VetroAI about itself and small talk are never searched or judged", async (t) => {
  const asked = withJudge(t, () => "SEARCH");
  for (const query of [...ABOUT_ITSELF, ...SMALL_TALK]) {
    assert.deepEqual(await intent.decideSearch({ query }), { search: false, by: "rules" }, query);
  }
  assert.equal(asked.length, 0, "the judge was never asked");
});

test("\"Ur name\" is answered without a search, with auto-search on or in Web Search mode", async (t) => {
  searches = 0;
  const asked = withJudge(t, () => "SEARCH");
  const prompts = [];
  withGroq(t, async (messages) => { prompts.push(messages); return say("I'm VetroAI."); });
  await chat("Ur name");
  await chat("who r u", { mode: "web_search" });
  await chat("thank u so much", { mode: "deep_search" });
  assert.equal(searches, 0);
  assert.equal(asked.length, 0);
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt.map((m) => m.content).join("\n"), /LIVE SEARCH RESULTS/);
    assert.match(prompt[0].content, /VetroAI/, "the answer comes from VetroAI's own facts");
  }
});

test("real lookups that mention a model, an AI or Ur are still judged", async (t) => {
  const asked = withJudge(t, () => "SEARCH");
  for (const query of ["what model is the iphone 17", "which ai is best for coding", "who is the ceo of google", "ancient city of ur"]) {
    assert.deepEqual(await intent.decideSearch({ query }), { search: true, by: "model" }, query);
  }
  assert.equal(asked.length, 4);
});

test("the judge reads text-speak in plain words, and knows about it", async (t) => {
  const asked = withJudge(t, () => "SEARCH");
  await intent.decideSearch({ query: "wat is the weather in chennai 2day" });
  const [system, user] = asked[0];
  assert.match(system.content, /"ur" is "your"/);
  assert.match(system.content, /questions to the assistant about itself/);
  assert.match(user.content, /Latest message: wat is the weather in chennai 2day\n\(In plain words: what is the weather in chennai today\)$/);
});

// The old identity check matched "what model" and "which ai" anywhere, so
// these were treated as questions about VetroAI and never searched.
test("questions about a phone's model or the best AI are searched, not taken as about VetroAI", async (t) => {
  searches = 0;
  withJudge(t, () => "SEARCH");
  withGroq(t, async () => say("Here it is [1]."));
  await chat("what model is the iphone 17");
  await chat("which ai is best for coding");
  assert.equal(searches, 2);
});
