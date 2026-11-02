import test from "node:test";
import assert from "node:assert/strict";

import { PLUGIN_CATALOG, pluginsForPrompt } from "../src/plugins/catalog.js";

const allOn = Object.fromEntries(PLUGIN_CATALOG.map((plugin) => [plugin.id, { installed: true }]));

// Matched anywhere in the text, "live" set off Web Search for "are u alive"
// (a question to VetroAI about itself) and "deliver".
test("plugin trigger words count only as whole words", () => {
  for (const q of ["are u alive", "deliver my parcel", "give an example", "write a paragraph", "replace this word", "a resource list", "olive oil recipe"]) {
    assert.deepEqual(pluginsForPrompt(allOn, q), [], q);
  }
});

test("trigger words still match with plain endings, and @mentions still work", () => {
  assert.deepEqual(pluginsForPrompt(allOn, "latest news"), ["web-search"]);
  assert.ok(pluginsForPrompt(allOn, "ipl matches today").includes("sports-live"));
  assert.ok(pluginsForPrompt(allOn, "studying for exams").includes("study-coach"));
  assert.ok(pluginsForPrompt(allOn, "restaurants near me").includes("maps"));
  assert.ok(pluginsForPrompt(allOn, "@web who is the cm").includes("web-search"));
  assert.deepEqual(pluginsForPrompt({}, "latest news"), [], "only installed plugins");
});
