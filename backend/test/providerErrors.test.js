const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// Every provider failure used to reach the user as "All available AI models are
// currently at capacity. Please try again in 30 seconds." That is only true for
// a rate limit; for a bad key or a wrong model name it sends people away to
// wait for a recovery that will never come.
const CASES = [
  ["401 Unauthorized", "Mistral service error: 401 {\"message\":\"Unauthorized\"}", "auth", false],
  ["invalid api key", "Incorrect API key provided", "auth", false],
  ["402 payment required", "Groq service error: 402 payment required", "quota", false],
  ["quota exhausted", "You exceeded your current quota, please check your plan", "quota", false],
  ["429 rate limit", "Rate limit reached for model, please retry", "rate_limit", true],
  ["404 unknown model", "Gemini request failed: 404 model not found", "bad_model", false],
  ["decommissioned model", "The model `llama-3.1-70b` has been decommissioned", "bad_model", false],
  ["network timeout", "Stream generation timeout", "network", true],
  ["dns failure", "fetch failed ENOTFOUND api.mistral.ai", "network", true],
  ["upstream 503", "SambaNova service error: 503 Service Unavailable", "upstream", true],
];

for (const [name, message, kind, retryable] of CASES) {
  test(`classifies ${name} as ${kind}`, () => {
    const result = orchestrator.classifyProviderError(message);
    assert.equal(result.kind, kind);
    assert.equal(result.retryable, retryable);
    assert.ok(result.userMessage("Mistral").length > 10, "produces a readable message");
  });
}

test("an auth failure never tells the user to just wait and retry", () => {
  const result = orchestrator.classifyProviderError("Mistral service error: 401 Unauthorized");
  const text = result.userMessage("Mistral");
  assert.match(text, /Mistral/);
  assert.match(text, /key/i, "names the real cause");
  assert.doesNotMatch(text, /30 seconds/, "must not send them away to wait");
  assert.doesNotMatch(text, /capacity/i, "must not blame capacity");
});

test("a rate limit still suggests waiting, because that one does recover", () => {
  const result = orchestrator.classifyProviderError("429 too many requests");
  assert.match(result.userMessage("Groq"), /30 seconds|another model/i);
});

test("the final message names the failing provider", () => {
  const failure = { provider: "mistral", ...orchestrator.classifyProviderError("401 Unauthorized") };
  const text = orchestrator.describeFinalFailure(failure, new Set(["mistral"]));
  assert.match(text, /Mistral/);
  assert.doesNotMatch(text, /other model/, "no fallback chain was walked, so don't claim one");
});

test("the final message reports how many fallbacks were tried", () => {
  const failure = { provider: "gemini", ...orchestrator.classifyProviderError("429 rate limit") };
  const text = orchestrator.describeFinalFailure(failure, new Set(["mistral", "groq", "gemini"]));
  assert.match(text, /Gemini/);
  assert.match(text, /2 other models/);
});

test("falls back to a safe message when nothing was recorded", () => {
  const text = orchestrator.describeFinalFailure(null, new Set());
  assert.match(text, /could not reach/i);
});

test("provider ids are shown with their display names", () => {
  assert.equal(orchestrator.providerLabel("mistral"), "Mistral");
  assert.equal(orchestrator.providerLabel("chatgpt"), "ChatGPT");
  assert.equal(orchestrator.providerLabel("fable"), "Claude Fable 5");
  assert.equal(orchestrator.providerLabel(undefined), "The AI model");
});

// The adapter used to snapshot config.mistralApiKey at module load while
// ProviderManager.isConfigured() read it dynamically. When those two disagreed
// the orchestrator would route to Mistral and the adapter would immediately
// refuse, which surfaced as a generic failure with no way to tell what broke.
test("the Mistral adapter reads its key at call time, matching ProviderManager", async () => {
  const { config } = require("../src/config/env");
  const providerManager = require("../src/services/ProviderManager");
  const mistralAdapter = require("../src/providers/mistralAdapter");

  const original = config.mistralApiKey;
  try {
    config.mistralApiKey = "";
    assert.equal(providerManager.isConfigured("mistral"), false);
    await assert.rejects(
      () => mistralAdapter.generateStream([{ role: "user", content: "hi" }]),
      /not configured/i,
      "with no key, the adapter refuses"
    );

    // Set after module load: the adapter must now agree that it is configured.
    config.mistralApiKey = "sk-set-after-load";
    assert.equal(providerManager.isConfigured("mistral"), true);
    await assert.rejects(
      () => mistralAdapter.generateStream([{ role: "user", content: "hi" }]),
      (err) => !/not configured/i.test(err.message),
      "it must attempt the call rather than claim it has no key"
    );
  } finally {
    config.mistralApiKey = original;
  }
});

test("a missing key is reported differently from a rejected one", () => {
  const missing = orchestrator.classifyProviderError("Mistral API key not configured on the backend.");
  assert.equal(missing.kind, "unconfigured");
  assert.match(missing.userMessage("Mistral"), /no API key configured/i);

  const rejected = orchestrator.classifyProviderError("Mistral service error: 401 Unauthorized");
  assert.equal(rejected.kind, "auth");
});
