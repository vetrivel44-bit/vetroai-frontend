const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");
const orchestrator = require("../src/services/AIOrchestrator");

const providerKeys = {
  plugsky: "plugskyApiKey",
  chatgpt: "chatgptApiKey",
  fable: "fableRapidApiKey",
  groq: "groqApiKey",
  mistral: "mistralApiKey",
  agnes: "agnesApiKey",
  sambanova: "sambanovaApiKey",
  gemini: "geminiApiKey",
};

function configureOnly(...names) {
  for (const configKey of Object.values(providerKeys)) config[configKey] = "";
  for (const name of names) config[providerKeys[name]] = "test-key";
  for (const provider of Object.values(providerManager.providers)) {
    provider.isSuspended = false;
    provider.consecutiveErrors = 0;
    provider.lastFailure = 0;
  }
}

// Collects the SSE payloads the orchestrator writes, so a request can be run
// without a real HTTP response or a real provider network call.
function fakeRes() {
  const events = [];
  return {
    events,
    writableEnded: false,
    write(chunk) {
      const match = /^data: (.*)\n\n$/s.exec(chunk);
      if (match) events.push(JSON.parse(match[1]));
    },
    end() { this.writableEnded = true; },
  };
}

async function run(provider, { streamFactory } = {}) {
  const res = fakeRes();
  const adapters = new Map();
  const used = [];
  for (const [name, entry] of Object.entries(providerManager.providers)) {
    adapters.set(name, entry.adapter);
    entry.adapter = {
      async generateStream() {
        used.push(name);
        if (streamFactory) return streamFactory(name);
        throw new Error(`${name} unavailable`);
      },
    };
  }
  try {
    await orchestrator.processRequest("test", {
      messages: [{ role: "user", content: "hi there, tell me something" }],
      mode: "normal",
      provider,
      memories: [],
      options: { temperature: 0.7, maxTokens: 64 },
    }, res);
  } finally {
    for (const [name, adapter] of adapters) providerManager.providers[name].adapter = adapter;
  }
  return { res, used, errors: res.events.filter(e => e.type === "error").map(e => e.data) };
}

test("provider names from the UI normalize onto backend provider keys", () => {
  assert.equal(providerManager.normalizeProviderName("Plugsky"), "plugsky");
  assert.equal(providerManager.normalizeProviderName("Claude Fable 5"), "fable");
  assert.equal(providerManager.normalizeProviderName(" AGNES "), "agnes");
  assert.equal(providerManager.normalizeProviderName("Auto"), null);
  assert.equal(providerManager.normalizeProviderName(undefined), null);
  assert.equal(providerManager.normalizeProviderName("not-a-provider"), null);
});

test("an explicit Plugsky pick never falls through to another model", async () => {
  configureOnly("plugsky", "agnes");
  const { used, errors } = await run("plugsky");
  assert.deepEqual(used, ["plugsky"], "only Plugsky may be attempted");
  assert.ok(!used.includes("agnes"), "Agnes must not answer a Plugsky request");
  assert.match(errors.join(" "), /Plugsky request failed/);
});

test("an unconfigured Plugsky pick reports itself instead of routing to Agnes", async () => {
  configureOnly("agnes");
  const { used, errors } = await run("Plugsky");
  assert.deepEqual(used, [], "no provider may answer for an unconfigured Plugsky");
  assert.match(errors.join(" "), /Plugsky is not configured/);
});

test("a suspended Plugsky pick is retried rather than skipped", async () => {
  configureOnly("plugsky", "agnes");
  providerManager.suspendProvider("plugsky", "test");
  const { used } = await run("plugsky");
  assert.deepEqual(used, ["plugsky"], "an explicit pick clears its own suspension");
});

test("a non-strict pick that is unconfigured still falls back, but says so", async () => {
  configureOnly("groq");
  const { res, used } = await run("Agnes");
  assert.deepEqual(used, ["groq"]);
  const statuses = res.events.filter(e => e.type === "status").map(e => e.data);
  assert.ok(
    statuses.some(s => /agnes is unavailable right now — answering with groq instead/i.test(s)),
    `expected a substitution notice, got: ${JSON.stringify(statuses)}`
  );
});
