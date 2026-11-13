import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { TEACHING, teachingNeed, teachingNote } from "../src/lib/teaching.js";

const require = createRequire(import.meta.url);
const backend = require("../../backend/src/config/teaching.js");

test("browser models get the same teaching guide as the backend's", () => {
  assert.equal(TEACHING, backend.TEACHING);
  assert.match(TEACHING, /Big picture first/);
  assert.match(TEACHING, /WHEN THEY SAY THEY DIDN'T UNDERSTAND/);
  assert.match(TEACHING, /Don't repeat it/);
  for (const subject of ["maths", "physics", "chemistry", "biology", "programming", "history", "economics", "grammar", "literature"]) {
    assert.match(TEACHING, new RegExp(subject), `covers ${subject}`);
  }
});

test("'I can't understand', in English and Indian languages, asks for a new explanation", () => {
  for (const said of ["I cant understand", "i still dont get it", "not clear, explain again", "its not clear", "explain it well", "Explain it in simple words",
    "simpler please", "Explain better", "can you explain once more", "im confused", "this is confusing", "you lost me", "too complicated",
    "puriyala", "enaku puriyala", "samajh nahi aaya", "nahi samjha", "ardham kaledu", "manassilayilla"]) {
    assert.equal(teachingNeed(said), "confused", said);
    assert.equal(backend.teachingNeed(said), "confused", `backend: ${said}`);
  }
  assert.match(teachingNote("I can't understand"), /completely different, simpler angle/);
  assert.match(teachingNote("I can't understand"), /Do not repeat or reword your last reply/);
});

test("'teach me' and 'explain how…' in any subject get taught, not just answered", () => {
  for (const said of ["teach me photosynthesis", "Can you teach me how loops work", "explain how a transistor works", "help me understand recursion",
    "explain dbms for a beginner", "explain photosynthesis in simple words", "eli5 inflation", "I want to learn trigonometry", "explain why the sky is blue"]) {
    assert.equal(teachingNeed(said), "teach", said);
  }
  assert.match(teachingNote("teach me photosynthesis"), /worked example step by step/);
});

test("ordinary messages are left alone", () => {
  for (const said of ["hi", "what is dbms", "I lost my phone yesterday", "the water is not clear in my tank because of algae, why is the pump not working",
    "is it clear to you what I said?", "book a table for two", "write a poem about rain"]) {
    assert.equal(teachingNeed(said), null, said);
    assert.equal(teachingNote(said), "");
  }
});
