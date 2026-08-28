const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePluginIds, buildPluginPrompt } = require("../src/config/plugins");

test("plugin ids are parsed, normalized, deduplicated, and allowlisted", () => {
  assert.deepEqual(
    normalizePluginIds('["WEB-SEARCH", "unknown", "web-search", "study-coach"]'),
    ["web-search", "study-coach"]
  );
});

test("active plugins produce trusted server-side instructions", () => {
  const prompt = buildPluginPrompt(["data-analyst", "code-runner"]);
  assert.match(prompt, /ACTIVE VETROAI PLUGINS/);
  assert.match(prompt, /Data Analyst/);
  assert.match(prompt, /Code Runner/);
  assert.doesNotMatch(prompt, /unknown/i);
});

