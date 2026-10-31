const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");

const providerKeys = {
  airouter: "airouterApiKey",
  chatgpt: "chatgptApiKey",
  fable: "fableRapidApiKey",
  groq: "groqApiKey",
  sarvam: "sarvamApiKey",
  gemini: "geminiApiKey",
  cohere: "cohereApiKey",
};

function configureOnly(providerName) {
  for (const configKey of Object.values(providerKeys)) config[configKey] = "";
  if (providerName) config[providerKeys[providerName]] = "test-key";
  for (const provider of Object.values(providerManager.providers)) {
    provider.isSuspended = false;
    provider.consecutiveErrors = 0;
  }
}

test("auto selection only chooses a configured provider", () => {
  configureOnly("chatgpt");
  assert.equal(providerManager.getBestProvider("normal", "Auto"), "chatgpt");
  assert.deepEqual(providerManager.getAvailableProviders(), ["chatgpt"]);
});

test("an unconfigured preferred provider falls back to a configured provider", () => {
  configureOnly("groq");
  assert.equal(providerManager.getBestProvider("normal", "Sarvam 105B"), "groq");
  assert.equal(providerManager.getFallbackProvider("sarvam"), "groq");
});

test("selection fails fast when no provider is configured", () => {
  configureOnly(null);
  assert.equal(providerManager.getBestProvider("normal", "Auto"), null);
  assert.equal(providerManager.getFallbackProvider("sarvam"), null);
  assert.equal(providerManager.getStats().sarvam.status, "unconfigured");
});

function configureMany(names) {
  configureOnly(null);
  for (const name of names) config[providerKeys[name]] = "test-key";
}

test("picker model names map to their backend family instead of being ignored", () => {
  configureMany(["airouter", "chatgpt", "fable", "gemini", "groq"]);
  assert.equal(providerManager.getBestProvider("web_search", "GPT-5.6 Sol"), "chatgpt");
  assert.equal(providerManager.getBestProvider("normal", "GPT-5.3 Codex"), "chatgpt");
  assert.equal(providerManager.getBestProvider("web_search", "Claude Sonnet 5"), "fable");
  assert.equal(providerManager.getBestProvider("web_search", "Gemini 3.1 Pro"), "gemini");
  assert.equal(providerManager.getBestProvider("normal", "Groq"), "groq");
  assert.equal(providerManager.getBestProvider("normal", "AI Router"), "airouter");
});

test("Auto does not route web searches to AI Router when another provider is available", () => {
  configureMany(["airouter", "chatgpt", "gemini"]);
  assert.notEqual(providerManager.getBestProvider("web_search", "Auto"), "airouter");
  assert.notEqual(providerManager.getBestProvider("research", "Auto"), "airouter");
  // Normal chat keeps its existing preference.
  assert.equal(providerManager.getBestProvider("normal", "Auto"), "airouter");
  // AI Router alone still answers rather than nothing.
  configureMany(["airouter"]);
  assert.equal(providerManager.getBestProvider("web_search", "Auto"), "airouter");
});

test("a key or billing problem parks the provider longer than a normal failure", () => {
  const pm = require("../src/services/ProviderManager");
  const p = pm.providers.sarvam;
  const realNow = Date.now;
  try {
    const t0 = realNow();
    Date.now = () => t0;
    pm.suspendProvider("sarvam", "Configuration problem: quota", 10 * 60 * 1000);
    Date.now = () => t0 + 60 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, true, "still parked after a minute");
    Date.now = () => t0 + 11 * 60 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, false, "back after ten minutes");

    Date.now = () => t0;
    pm.suspendProvider("sarvam", "Rate limit reached");
    Date.now = () => t0 + 25 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, false, "a rate limit keeps the short cooldown");
  } finally {
    Date.now = realNow;
    p.isSuspended = false;
    p.consecutiveErrors = 0;
  }
});

test("Ling 3.0 Flash and DeepSeek V4.1 Flash are both answered by AI Router", () => {
  configureMany(["airouter", "groq"]);
  assert.equal(providerManager.getBestProvider("normal", "Ling 3.0 Flash"), "airouter");
  assert.equal(providerManager.getBestProvider("normal", "DeepSeek V4.1 Flash"), "airouter");
});

test("VetroAI (Qwen 3.7 Flash) is answered by AI Router", () => {
  configureMany(["airouter", "groq"]);
  assert.equal(providerManager.getBestProvider("normal", "VetroAI"), "airouter");
  assert.equal(providerManager.getBestProvider("normal", "vetroai"), "airouter");
});
