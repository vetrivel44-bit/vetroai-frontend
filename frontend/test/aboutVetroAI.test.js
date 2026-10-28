import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { ABOUT_VETROAI, VETROAI_IDENTITY } from "../src/lib/aboutVetroAI.js";
import { ABOUT_SELF, needsLiveInfo } from "../src/lib/liveInfoIntent.js";

const require = createRequire(import.meta.url);
const backend = require("../../backend/src/config/aboutVetroAI.js");
const backendIntent = require("../../backend/src/services/liveInfoIntent.js");

test("browser models get the same VetroAI facts as the backend's", () => {
  assert.equal(ABOUT_VETROAI, backend.ABOUT_VETROAI);
  assert.ok(VETROAI_IDENTITY.includes(ABOUT_VETROAI));
  assert.match(VETROAI_IDENTITY, /You are VetroAI/);
  assert.equal(String(ABOUT_SELF), String(backendIntent.ABOUT_SELF));
});

test("a question about VetroAI itself doesn't search the web", () => {
  assert.equal(needsLiveInfo("tell about VetroAi ceo"), false);
  assert.equal(needsLiveInfo("tell about gemini argon"), true);
});
