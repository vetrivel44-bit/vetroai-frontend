const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");

const providerKeys = {
  plugsky: "plugskyApiKey",
  chatgpt: "chatgptApiKey",
  fable: "fableRapidApiKey",
  groq: "groqApiKey",
  mistral: "mistralApiKey",
  agnes: "agnesApiKey",
  sambanova: "sambanovaApiKey",
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
  assert.equal(providerManager.getBestProvider("normal", "Agnes"), "groq");
  assert.equal(providerManager.getFallbackProvider("agnes"), "groq");
});

test("selection fails fast when no provider is configured", () => {
  configureOnly(null);
  assert.equal(providerManager.getBestProvider("normal", "Auto"), null);
  assert.equal(providerManager.getFallbackProvider("agnes"), null);
  assert.equal(providerManager.getStats().agnes.status, "unconfigured");
});

function configureMany(names) {
  configureOnly(null);
  for (const name of names) config[providerKeys[name]] = "test-key";
}

test("picker model names map to their backend family instead of being ignored", () => {
  configureMany(["plugsky", "chatgpt", "fable", "gemini", "groq"]);
  assert.equal(providerManager.getBestProvider("web_search", "GPT-5.6 Sol"), "chatgpt");
  assert.equal(providerManager.getBestProvider("normal", "GPT-5.3 Codex"), "chatgpt");
  assert.equal(providerManager.getBestProvider("web_search", "Claude Sonnet 5"), "fable");
  assert.equal(providerManager.getBestProvider("web_search", "Gemini 3.1 Pro"), "gemini");
  assert.equal(providerManager.getBestProvider("normal", "Groq"), "groq");
  assert.equal(providerManager.getBestProvider("normal", "Plugsky"), "plugsky");
});

test("Auto does not route web searches to Plugsky when another provider is available", () => {
  configureMany(["plugsky", "chatgpt", "gemini"]);
  assert.notEqual(providerManager.getBestProvider("web_search", "Auto"), "plugsky");
  assert.notEqual(providerManager.getBestProvider("research", "Auto"), "plugsky");
  // Normal chat keeps its existing preference.
  assert.equal(providerManager.getBestProvider("normal", "Auto"), "plugsky");
  // Plugsky alone still answers rather than nothing.
  configureMany(["plugsky"]);
  assert.equal(providerManager.getBestProvider("web_search", "Auto"), "plugsky");
});

test("a key or billing problem parks the provider longer than a normal failure", () => {
  const pm = require("../src/services/ProviderManager");
  const p = pm.providers.sambanova;
  const realNow = Date.now;
  try {
    const t0 = realNow();
    Date.now = () => t0;
    pm.suspendProvider("sambanova", "Configuration problem: quota", 10 * 60 * 1000);
    Date.now = () => t0 + 60 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, true, "still parked after a minute");
    Date.now = () => t0 + 11 * 60 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, false, "back after ten minutes");

    Date.now = () => t0;
    pm.suspendProvider("sambanova", "Rate limit reached");
    Date.now = () => t0 + 25 * 1000;
    pm.checkHealth();
    assert.equal(p.isSuspended, false, "a rate limit keeps the short cooldown");
  } finally {
    Date.now = realNow;
    p.isSuspended = false;
    p.consecutiveErrors = 0;
  }
});
