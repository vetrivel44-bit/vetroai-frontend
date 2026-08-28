import test from "node:test";
import assert from "node:assert/strict";

import { getPluginMentionContext } from "./catalog.js";

const installed = {
  jobs: { installed: true, enabled: true },
  maps: { installed: true, enabled: true },
  "web-search": { installed: true, enabled: true },
};

test("opens the picker for a partial installed plugin mention", () => {
  assert.deepEqual(getPluginMentionContext(installed, "Find @Job", 9), {
    query: "Job",
    start: 5,
  });
  assert.deepEqual(getPluginMentionContext(installed, "@Job "), {
    query: "Job ",
    start: 0,
  });
});

test("closes the picker after a complete plugin mention and prompt text", () => {
  assert.equal(
    getPluginMentionContext(installed, "@Job Search software engineers in Bangalore"),
    null,
  );
  assert.equal(getPluginMentionContext(installed, "@Maps temples near me"), null);
  assert.equal(getPluginMentionContext(installed, "@Web Search h"), null);
  assert.equal(getPluginMentionContext({}, "@Web Search h"), null);
});

test("does not treat email addresses as plugin mentions", () => {
  assert.equal(getPluginMentionContext(installed, "email jobs@example.com"), null);
});
