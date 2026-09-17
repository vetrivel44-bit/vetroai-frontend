import test from "node:test";
import assert from "node:assert/strict";

import { pickBrowserRetryProvider } from "../src/lib/browserRetry.js";

// The bug this guards: when every backend provider was rate limited or out of
// quota, the turn ended with the backend's raw complaint ("All available AI
// models are currently at capacity…") in the chat bubble, even though a
// browser model could still have answered.
test("a plain text turn falls back to a browser model", () => {
  assert.equal(pickBrowserRetryProvider(), "GPT-5.6 Sol");
});

test("a code-shaped question prefers Codex", () => {
  assert.equal(pickBrowserRetryProvider({ preferCodex: true }), "GPT-5.3 Codex");
});

test("a model already tried this turn is not retried", () => {
  assert.equal(
    pickBrowserRetryProvider({ attempted: ["GPT-5.6 Sol"] }),
    "GPT-5.6 Terra"
  );
  assert.equal(
    pickBrowserRetryProvider({ preferCodex: true, attempted: ["GPT-5.3 Codex", "GPT-5.6 Sol"] }),
    "GPT-5.6 Terra"
  );
});

test("nothing is left once every browser model has failed", () => {
  assert.equal(
    pickBrowserRetryProvider({ attempted: ["GPT-5.6 Sol", "GPT-5.6 Terra"] }),
    null
  );
});

// Attachments only reach a model through the backend, so there is nothing to
// retry in the browser — the real error has to surface instead.
test("a turn with files does not fall back", () => {
  assert.equal(pickBrowserRetryProvider({ hasFiles: true }), null);
});

test("no fallback when Puter never loaded", () => {
  assert.equal(pickBrowserRetryProvider({ puterAvailable: false }), null);
});
