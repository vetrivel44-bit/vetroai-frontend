const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");
const { normalizePluginIds, buildPluginPrompt, KNOWN_PLUGIN_IDS } = require("../src/config/plugins");

test("plugin ids are parsed, normalized, deduplicated, and allowlisted", () => {
  assert.deepEqual(
    normalizePluginIds('["WEB-SEARCH", "unknown", "web-search", "study-coach"]'),
    ["web-search", "study-coach"]
  );
});

test("active plugins produce trusted server-side instructions", () => {
  const prompt = buildPluginPrompt(["data-analyst", "code-runner"]);
  assert.match(prompt, /ACTIVE PLUGINS/);
  assert.match(prompt, /Data Analyst/);
  assert.match(prompt, /Code Runner/);
  assert.doesNotMatch(prompt, /unknown/i);
});


// The catalog lives in the frontend; the server keeps its own list of ids.
// Skipped where only the backend is checked out.
const CATALOG = path.join(__dirname, "../../frontend/src/plugins/catalog.js");
test("the server knows every plugin id in the app's catalog, and no others", { skip: !fs.existsSync(CATALOG) }, async () => {
  const { PLUGIN_CATALOG } = await import(CATALOG);
  assert.deepEqual([...KNOWN_PLUGIN_IDS].sort(), PLUGIN_CATALOG.map((p) => p.id).sort());
});
