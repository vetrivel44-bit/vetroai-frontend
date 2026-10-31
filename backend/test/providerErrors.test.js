const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// Every provider failure used to reach the user as "All available AI models are
// currently at capacity. Please try again in 30 seconds." That is only true for
// a rate limit; for a bad key or a wrong model name it sends people away to
// wait for a recovery that will never come.
const CASES = [
  ["401 Unauthorized", "AI Router service error: 401 {\"message\":\"Unauthorized\"}", "auth", false],
  ["invalid api key", "Incorrect API key provided", "auth", false],
  ["402 payment required", "Groq service error: 402 payment required", "quota", false],
  ["quota exhausted", "You exceeded your current quota, please check your plan", "quota", false],
  ["429 rate limit", "Rate limit reached for model, please retry", "rate_limit", true],
  ["404 unknown model", "Gemini request failed: 404 model not found", "bad_model", false],
  ["decommissioned model", "The model `llama-3.1-70b` has been decommissioned", "bad_model", false],
  ["network timeout", "Stream generation timeout", "network", true],
  ["dns failure", "fetch failed ENOTFOUND api.airouter.in", "network", true],
  ["upstream 503", "Agnes service error: 503 Service Unavailable", "upstream", true],
];

for (const [name, message, kind, retryable] of CASES) {
  test(`classifies ${name} as ${kind}`, () => {
    const result = orchestrator.classifyProviderError(message);
    assert.equal(result.kind, kind);
    assert.equal(result.retryable, retryable);
    assert.ok(result.userMessage("AI Router").length > 10, "produces a readable message");
  });
}

test("an auth failure never tells the user to just wait and retry", () => {
  const result = orchestrator.classifyProviderError("AI Router service error: 401 Unauthorized");
  const text = result.userMessage("AI Router");
  assert.match(text, /AI Router/);
  assert.match(text, /key/i, "names the real cause");
  assert.doesNotMatch(text, /30 seconds/, "must not send them away to wait");
  assert.doesNotMatch(text, /capacity/i, "must not blame capacity");
});

test("a rate limit still suggests waiting, because that one does recover", () => {
  const result = orchestrator.classifyProviderError("429 too many requests");
  assert.match(result.userMessage("Groq"), /30 seconds|another model/i);
});

test("the final message names the failing provider", () => {
  const failure = { provider: "airouter", ...orchestrator.classifyProviderError("401 Unauthorized") };
  const text = orchestrator.describeFinalFailure(failure, new Set(["airouter"]));
  assert.match(text, /AI Router/);
  assert.doesNotMatch(text, /other model/, "no fallback chain was walked, so don't claim one");
});

test("the final message reports how many fallbacks were tried", () => {
  const failure = { provider: "gemini", ...orchestrator.classifyProviderError("429 rate limit") };
  const text = orchestrator.describeFinalFailure(failure, new Set(["airouter", "groq", "gemini"]));
  assert.match(text, /Gemini/);
  assert.match(text, /2 other models/);
});

test("falls back to a safe message when nothing was recorded", () => {
  const text = orchestrator.describeFinalFailure(null, new Set());
  assert.match(text, /could not reach/i);
});

test("provider ids are shown with their display names", () => {
  assert.equal(orchestrator.providerLabel("airouter"), "AI Router");
  assert.equal(orchestrator.providerLabel("chatgpt"), "ChatGPT");
  assert.equal(orchestrator.providerLabel("fable"), "Claude Fable 5");
  assert.equal(orchestrator.providerLabel(undefined), "The AI model");
});

// The adapter used to snapshot config.airouterApiKey at module load while
// ProviderManager.isConfigured() read it dynamically. When those two disagreed
// the orchestrator would route to AI Router and the adapter would immediately
// refuse, which surfaced as a generic failure with no way to tell what broke.
test("the AI Router adapter reads its key at call time, matching ProviderManager", async () => {
  const { config } = require("../src/config/env");
  const providerManager = require("../src/services/ProviderManager");
  const airouterAdapter = require("../src/providers/airouterAdapter");

  const original = config.airouterApiKey;
  try {
    config.airouterApiKey = "";
    assert.equal(providerManager.isConfigured("airouter"), false);
    await assert.rejects(
      () => airouterAdapter.generateStream([{ role: "user", content: "hi" }]),
      /not configured/i,
      "with no key, the adapter refuses"
    );

    // Set after module load: the adapter must now agree that it is configured.
    config.airouterApiKey = "sk-set-after-load";
    assert.equal(providerManager.isConfigured("airouter"), true);
    await assert.rejects(
      () => airouterAdapter.generateStream([{ role: "user", content: "hi" }]),
      (err) => !/not configured/i.test(err.message),
      "it must attempt the call rather than claim it has no key"
    );
  } finally {
    config.airouterApiKey = original;
  }
});

test("a missing key is reported differently from a rejected one", () => {
  const missing = orchestrator.classifyProviderError("AI Router API key not configured on the backend.");
  assert.equal(missing.kind, "unconfigured");
  assert.match(missing.userMessage("AI Router"), /no API key configured/i);

  const rejected = orchestrator.classifyProviderError("AI Router service error: 401 Unauthorized");
  assert.equal(rejected.kind, "auth");
});

test("a billing or key failure shows the provider's own words", () => {
  const raw = 'Sarvam service error: 402 {"error":{"message":"Insufficient credits in workspace ws_123","code":"insufficient_credits"}}';
  const failure = { provider: "sarvam", ...orchestrator.classifyProviderError(raw), detail: orchestrator.providerDetail(raw) };
  assert.equal(failure.kind, "quota");
  const text = orchestrator.describeFinalFailure(failure, new Set(["sarvam"]));
  assert.match(text, /Sarvam has no quota left/);
  assert.match(text, /Sarvam said: "Insufficient credits in workspace ws_123"/);
});

test("the provider's words are cleaned up and kept short", () => {
  assert.equal(orchestrator.providerDetail("Groq service error: 402 payment required"), "payment required");
  assert.equal(orchestrator.providerDetail('Sarvam service error: 429 {"message":"Quota exceeded: 60 requests per minute"}'), "Quota exceeded: 60 requests per minute");
  assert.ok(orchestrator.providerDetail("x".repeat(500)).length <= 180);
});

test("a timeout doesn't append raw error text", () => {
  const raw = "Sarvam connect timeout after 30000ms";
  const failure = { provider: "sarvam", ...orchestrator.classifyProviderError(raw), detail: orchestrator.providerDetail(raw) };
  assert.doesNotMatch(orchestrator.describeFinalFailure(failure, new Set(["sarvam"])), /said:/);
});
