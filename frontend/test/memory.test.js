import test from "node:test";
import assert from "node:assert/strict";

import {
  extractMemory,
  isDuplicate,
  makeMemory,
  toPromptList,
  MAX_MEMORY_LENGTH,
} from "../src/lib/memory.js";

test("a remember instruction is captured without its prefix", () => {
  assert.equal(extractMemory("Remember that my name is Vetrivel"), "my name is Vetrivel");
  assert.equal(extractMemory("remember my name is Vetrivel."), "my name is Vetrivel");
  assert.equal(extractMemory("Please remember: I study at 6am"), "I study at 6am");
  assert.equal(extractMemory("Note that I prefer short answers"), "I prefer short answers");
  assert.equal(extractMemory("Keep in mind I'm preparing for GATE"), "I'm preparing for GATE");
  assert.equal(extractMemory("Don't forget my exam is in June"), "my exam is in June");
});

test("a passing mention of remembering is not a save instruction", () => {
  // The word has to lead the message, or ordinary conversation would silently
  // fill the user's memory with fragments they never asked to store.
  assert.equal(extractMemory("I can never remember which one is faster"), null);
  assert.equal(extractMemory("Do you remember what we discussed?"), null);
  assert.equal(extractMemory("What should I keep in mind when deploying?"), null);
});

test("an instruction with nothing to store is rejected", () => {
  assert.equal(extractMemory("remember"), null);
  assert.equal(extractMemory(""), null);
  assert.equal(extractMemory(null), null);
  assert.equal(extractMemory(undefined), null);
});

test("a bare pronoun points at something rather than carrying it", () => {
  // "Remember this" refers to an earlier message; storing the pronoun would
  // save a memory that means nothing once that conversation is gone.
  assert.equal(extractMemory("Remember this"), null);
  assert.equal(extractMemory("remember that"), null);
  assert.equal(extractMemory("Note it."), null);
});

test("an over-long or multi-paragraph message is not a fact", () => {
  assert.equal(extractMemory("Remember " + "x".repeat(MAX_MEMORY_LENGTH + 10)), null);
  assert.equal(extractMemory("Remember this\n\nand also all of that"), null);
});

test("duplicates are detected regardless of case, spacing and punctuation", () => {
  const memories = [makeMemory("My name is Vetrivel")];
  assert.equal(isDuplicate(memories, "my   name is vetrivel."), true);
  assert.equal(isDuplicate(memories, "My name is Ramalingam"), false);
  assert.equal(isDuplicate([], "anything"), false);
});

test("a memory is trimmed, capped and given a distinct id", () => {
  const m = makeMemory("  spaced out  ", "chat");
  assert.equal(m.text, "spaced out");
  assert.equal(m.source, "chat");
  assert.ok(typeof m.createdAt === "number");
  assert.equal(makeMemory("x".repeat(MAX_MEMORY_LENGTH + 50)).text.length, MAX_MEMORY_LENGTH);
  assert.notEqual(makeMemory("a").id, makeMemory("a").id);
});

test("the prompt list is plain strings, oldest first", () => {
  const list = toPromptList([
    { text: "newer", createdAt: 200 },
    { text: "older", createdAt: 100 },
    { text: "", createdAt: 150 },
  ]);
  assert.deepEqual(list, ["older", "newer"]);
});
