const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");

const providerKeys = {
  chatgpt: "chatgptApiKey",
  groq: "groqApiKey",
  mistral: "mistralApiKey",
  agnes: "agnesApiKey",
  sambanova: "sambanovaApiKey",
  gemini: "geminiApiKey",
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
