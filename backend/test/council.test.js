const test = require("node:test");
const assert = require("node:assert/strict");

const council = require("../src/services/councilService");

test("the council sits for questions that need judgement, not for small talk or lookups", () => {
  const sits = (query, extra = {}) => council.needsCouncil({ query, ...extra });
  assert.equal(sits("Should I buy an electric scooter or a petrol one for daily city commutes?"), true);
  assert.equal(sits("Compare term insurance and endowment plans for a 30 year old"), true);
  assert.equal(sits("Why does my React component re-render twice on every click?"), true);
  assert.equal(sits("What is the capital of Australia, by the way?"), false, "a lookup");
  assert.equal(sits("hi there"), false, "too short");
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { isGreeting: true }), false);
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { drawing: true }), false);
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { needsVision: true }), false);
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { hasAttachments: true }), false);
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { mode: "deep_search" }), false, "DeepSearch has its own research");
  assert.equal(sits("Should I buy an electric scooter or a petrol one?", { enabled: false }), false, "LLM_COUNCIL=off");
});

test("effort decides how readily it sits", () => {
  const plain = "Give me smart ways to cut my electricity bill this summer.";
  assert.equal(council.needsCouncil({ query: plain, effort: "max" }), true, "Max: any real question");
  assert.equal(council.needsCouncil({ query: plain, effort: "deep" }), true);
  assert.equal(council.needsCouncil({ query: plain, effort: "quick" }), false);
  assert.equal(council.needsCouncil({ query: "Should I take the job offer in Bangalore or stay in Chennai?", effort: "quick" }), true, "Quick: only the clearest");
  assert.equal(council.needsCouncil({ query: "Tell me what to pack. Also what's the weather like? And is it safe?" }), true, "several questions at once");
});

test("members are the available models other than the writer, free ones first", () => {
  assert.deepEqual(council.pickMembers({ available: ["airouter", "groq", "gemini", "cohere", "fable"], chair: "airouter" }), ["groq", "gemini", "cohere"]);
  assert.deepEqual(council.pickMembers({ available: ["groq", "gemini"], chair: "groq" }), ["gemini"]);
  assert.deepEqual(council.pickMembers({ available: ["groq"], chair: "groq" }), [], "nobody else: no council");
  assert.deepEqual(council.pickMembers({ available: ["groq", "fable", "gemini"], chair: "gemini", order: "fable, groq" }), ["fable", "groq"], "LLM_COUNCIL_MEMBERS");
});

test("members get a short brief, the search results and the last few turns", () => {
  const history = [
    { role: "assistant", content: "Earlier reply" },
    { role: "user", content: "Should I fix my rate loan?" },
  ];
  const messages = council.memberMessages({ history, webContext: "RBI held the repo rate at 6.5%.", clockText: "It is Friday." });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /council of AI models/);
  assert.match(messages[0].content, /RBI held the repo rate/);
  assert.match(messages[0].content, /It is Friday/);
  assert.deepEqual(messages.slice(1).map((m) => m.role), ["user"], "starts with the person");
  assert.ok(messages[0].content.length < 1500 + 5000);
});

test("the council asks everyone at once and copes with a failure and a timeout", async () => {
  const updates = [];
  const result = await council.runCouncil({
    members: ["groq", "gemini", "cohere"],
    labelFor: (seat) => seat.provider.toUpperCase(),
    messages: [],
    timeoutMs: 80,
    ask: async ({ provider }) => {
      if (provider === "gemini") throw new Error("busy");
      if (provider === "cohere") return new Promise(() => {});
      return "<think>hmm</think>Go with the fixed rate.";
    },
    onUpdate: (snapshot) => updates.push(snapshot),
  });
  assert.equal(result.phase, "done");
  assert.deepEqual(result.members.map((m) => [m.name, m.status]), [["GROQ", "answered"], ["GEMINI", "failed"], ["COHERE", "failed"]]);
  assert.equal(result.members[0].answer, "Go with the fixed rate.", "reasoning tags are dropped");
  assert.equal(updates[0].phase, "asking");
  assert.ok(updates[0].members.every((m) => m.status === "asking"));
  assert.equal(updates.at(-1).phase, "done");
});

test("a model that can't answer is replaced by the next one in line", async () => {
  const seats = council.pickSeats({ available: ["groq", "gemini", "cohere", "airouter"], chair: "gemini", modelOf: (s) => (s.provider === "airouter" ? `m-${s.variant || "default"}` : "") });
  assert.deepEqual(seats.slice(0, 4).map((s) => `${s.provider}:${s.variant}`), ["groq:", "cohere:", "airouter:", "airouter:Ling 3.0 Flash"]);
  const asked = [];
  const result = await council.runCouncil({
    seats,
    labelFor: (seat) => seat.variant || seat.provider,
    messages: [],
    timeoutMs: 60,
    ask: async (seat) => {
      asked.push(seat.variant || seat.provider);
      if (seat.provider === "cohere") throw new Error("quota");
      if (seat.provider === "airouter" && !seat.variant) return new Promise(() => {}); // too slow
      return `${seat.variant || seat.provider}: fixed rate.`;
    },
  });
  assert.deepEqual(result.members.map((m) => [m.name, m.status, m.standsInFor || null]), [
    ["groq", "answered", null],
    ["cohere", "failed", null],
    ["airouter", "failed", null],
    ["Ling 3.0 Flash", "answered", "cohere"],
    ["VetroAI", "answered", "airouter"],
  ]);
  assert.equal(result.members.filter((m) => m.status === "answered").length, 3, "still three answers");
  assert.ok(!asked.includes("Grok 4.20"), "nobody else asked once three answered");
});

test("stand-ins stop when the council's time is up", async () => {
  const result = await council.runCouncil({
    members: ["groq", "gemini", "cohere", "sarvam"],
    size: 1,
    totalMs: 50,
    timeoutMs: 40,
    labelFor: (seat) => seat.provider,
    messages: [],
    ask: async () => new Promise(() => {}),
  });
  assert.deepEqual(result.members.map((m) => m.name), ["groq"], "no time left for a stand-in");
});

test("the writer never sits on its own council; AI Router's other models can", () => {
  const modelOf = (s) => (s.provider === "airouter" ? (s.variant ? `ar/${s.variant}` : "ar/default") : "");
  const seats = council.pickSeats({ available: ["airouter", "groq"], chair: "airouter", chairModel: "ar/default", modelOf });
  assert.deepEqual(seats.map((s) => `${s.provider}:${s.variant}`), ["groq:", "airouter:Ling 3.0 Flash", "airouter:VetroAI", "airouter:Grok 4.20"]);
  const groqChair = council.pickSeats({ available: ["airouter", "groq"], chair: "groq", modelOf });
  assert.ok(!groqChair.some((s) => s.provider === "groq"));
});

test("the writer's notes hold every answer, and say never to mention them", () => {
  const brief = council.chairBrief({ members: [
    { name: "Groq", status: "answered", answer: "Fixed rate, because rates may rise." },
    { name: "Gemini", status: "failed", answer: "" },
    { name: "Cohere", status: "answered", answer: "Floating rate is cheaper today. ".repeat(80) },
  ] }, { tight: true });
  assert.match(brief, /COUNCIL NOTES/);
  assert.match(brief, /2 other AI models/);
  assert.match(brief, /Fixed rate, because rates may rise/);
  assert.doesNotMatch(brief, /Gemini/, "a member that failed isn't quoted");
  assert.match(brief, /Don't mention the council/);
  assert.ok(brief.length < 2600, "a tight writer gets shorter answers");
  assert.equal(council.chairBrief({ members: [{ name: "Groq", status: "failed" }] }), "", "nobody answered: no notes");
});

test("a hard question: the council sits, the app hears it, and the writer gets the answers", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");
  const streamOf = (text) => (async function* () {
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;
    yield "data: [DONE]\n";
  })();
  const sent = {};
  const adapterFor = (name) => ({
    generateStream: async (messages, options) => {
      sent[name] = { messages, options };
      return streamOf(name === "airouter" ? "Here is the final answer." : `${name} says: fixed rate.`);
    },
  });
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "airouter");
  patch(providerManager, "getAdapter", (name) => adapterFor(name));
  patch(providerManager, "getAvailableProviders", () => ["airouter", "groq", "gemini"]);
  patch(providerManager, "isConfigured", () => true);
  patch(providerManager, "updateMetrics", () => {});
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });

  const events = [];
  const res = { write: (line) => { const m = /^data: (.*)\n\n$/s.exec(line); if (m) events.push(JSON.parse(m[1])); }, end: () => {}, writableEnded: false, locals: {} };
  await orchestrator.processRequest(`t_${Math.random()}`, {
    messages: [{ role: "user", content: "Should I choose a fixed or floating rate home loan this year?" }],
    mode: "normal", effort: "balanced", options: {},
  }, res);

  const councilEvents = events.filter((e) => e.type === "council");
  assert.ok(councilEvents.length >= 2, "the app hears the council as it sits");
  const done = councilEvents.at(-1).data;
  assert.equal(done.phase, "done");
  assert.deepEqual(done.members.map((m) => m.name), ["Groq", "Gemini", "Ling 3.0 Flash"], "AI Router's other models sit too");
  assert.deepEqual(done.members.map((m) => m.status), ["answered", "answered", "answered"]);
  assert.match(done.members[0].answer, /groq says: fixed rate/);

  assert.match(sent.groq.messages[0].content, /council of AI models/, "members get the short brief");
  assert.equal(sent.groq.options.maxTokens, council.MEMBER_MAX_TOKENS);
  const writerPrompt = sent.airouter.messages[0].content;
  assert.match(writerPrompt, /COUNCIL NOTES/);
  assert.match(writerPrompt, /gemini says: fixed rate/);
  const answer = events.filter((e) => e.type === "content").map((e) => e.data).join("");
  assert.match(answer, /Here is the final answer/);
  assert.doesNotMatch(answer, /says: fixed rate/, "members' answers never reach the reply");
});

test("a greeting never convenes the council", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");
  const asked = [];
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "airouter");
  patch(providerManager, "getAdapter", (name) => ({
    generateStream: async () => { asked.push(name); return (async function* () { yield 'data: {"choices":[{"delta":{"content":"Hi!"}}]}\n'; })(); },
  }));
  patch(providerManager, "getAvailableProviders", () => ["airouter", "groq", "gemini"]);
  patch(providerManager, "isConfigured", () => true);
  patch(providerManager, "updateMetrics", () => {});
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });
  const res = { write: () => {}, end: () => {}, writableEnded: false, locals: {} };
  await orchestrator.processRequest(`t_${Math.random()}`, { messages: [{ role: "user", content: "hello" }], mode: "normal", effort: "max", options: {} }, res);
  assert.deepEqual(asked, ["airouter"]);
});
