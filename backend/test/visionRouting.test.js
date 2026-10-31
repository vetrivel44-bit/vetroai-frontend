const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");
const orchestrator = require("../src/services/AIOrchestrator");

const ALL_KEYS = [
  "airouterApiKey", "chatgptApiKey", "fableRapidApiKey", "groqApiKey",
  "agnesApiKey", "geminiApiKey", "cohereApiKey",
];

function configureOnly(names) {
  const keyFor = {
    airouter: "airouterApiKey", chatgpt: "chatgptApiKey", fable: "fableRapidApiKey",
    groq: "groqApiKey", agnes: "agnesApiKey",
    gemini: "geminiApiKey", cohere: "cohereApiKey",
  };
  for (const k of ALL_KEYS) config[k] = "";
  for (const n of names) config[keyFor[n]] = "test-key";
  for (const p of Object.values(providerManager.providers)) {
    p.isSuspended = false;
    p.consecutiveErrors = 0;
  }
}

// An image-carrying request must never land on a text-only adapter: those
// ignore the `images` field entirely, so the model would describe a picture it
// never received. Only gemini and cohere read it.
test("the vision fallback walk offers only image-capable providers", () => {
  configureOnly(["airouter", "groq", "gemini", "cohere"]);
  const attempted = new Set(["gemini"]);
  assert.equal(orchestrator.nextFallback("gemini", attempted, true), "cohere");
});

test("after gemini and cohere, an image goes to groq's vision model", () => {
  configureOnly(["airouter", "groq", "gemini", "cohere"]);
  assert.equal(orchestrator.nextFallback("cohere", new Set(["gemini", "cohere"]), true), "groq");
});

test("the vision walk ends rather than handing an image to a text-only provider", () => {
  configureOnly(["airouter", "groq", "gemini", "cohere"]);
  const attempted = new Set(["gemini", "cohere", "groq"]);
  assert.equal(orchestrator.nextFallback("groq", attempted, true), null);
});

test("cohere alone can carry a vision request when gemini is unconfigured", () => {
  configureOnly(["airouter", "groq", "cohere"]);
  assert.equal(orchestrator.nextFallback("airouter", new Set(), true), "cohere");
});

// The non-vision walk is unchanged, including spending the last attempt on
// Cohere so a capped budget still reaches the universal fallback.
test("a text request still walks the normal chain", () => {
  configureOnly(["airouter", "groq", "gemini", "cohere"]);
  const next = orchestrator.nextFallback("airouter", new Set(["airouter"]), false);
  assert.ok(next && next !== "airouter");
});

test("the final attempt of a text request goes to cohere", () => {
  configureOnly(["airouter", "groq", "gemini", "cohere"]);
  assert.equal(
    orchestrator.nextFallback("groq", new Set(["airouter", "groq"]), false, true),
    "cohere"
  );
});

test("the last-attempt rule does not re-offer cohere once it has been tried", () => {
  configureOnly(["airouter", "groq", "cohere"]);
  const next = orchestrator.nextFallback("groq", new Set(["airouter", "groq", "cohere"]), false, true);
  assert.notEqual(next, "cohere");
});
