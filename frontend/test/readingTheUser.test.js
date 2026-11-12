import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { READING_THE_USER, thisMessageNote } from "../src/lib/readingTheUser.js";

const require = createRequire(import.meta.url);
const backend = require("../../backend/src/config/readingTheUser.js");

// Browser models are told how people type, word for word as the backend's.
test("browser models get the same reading guide as the backend's", () => {
  assert.equal(READING_THE_USER, backend.READING_THE_USER);
  assert.match(READING_THE_USER, /"Ur name" asks your name \(not the city of Ur\)/);
  assert.match(READING_THE_USER, /Short follow-ups .* are about your last reply/);
  assert.match(READING_THE_USER, /Reply in the user's language and script/);
});

test("a question about VetroAI itself gets a note for that turn, in plain words", () => {
  for (const q of ["Ur name", "who r u", "tera naam kya hai", "who are you", "what is dbms", "in tamil", "how r u"]) {
    assert.equal(thisMessageNote(q), backend.thisMessageNote(q), q);
  }
  assert.match(thisMessageNote("Ur name"), /In plain words: "your name"\. Answer it as VetroAI/);
  assert.doesNotMatch(thisMessageNote("who are you"), /In plain words/);
  assert.equal(thisMessageNote("what is dbms"), "");
});
