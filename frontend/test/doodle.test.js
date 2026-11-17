import { test } from "node:test";
import assert from "node:assert/strict";
import { DOODLE_STYLES, doodlePrompt, doodleRequestText, hasDrawing, smoothSegments, styleOf } from "../src/lib/doodle.js";

test("the image model keeps the doodle's composition and makes it the chosen look", () => {
  const prompt = doodlePrompt({ description: "a house with a sun", style: "watercolour" });
  assert.match(prompt, /rough hand-drawn doodle of a house with a sun/);
  assert.match(prompt, /watercolour painting/);
  assert.match(prompt, /same things, in the same places, at the same sizes/);
  assert.match(prompt, /No text, captions or signature/);
  assert.match(prompt, /Make every character original/);
  assert.doesNotMatch(prompt, /Work out what the doodle shows/, "it was told what it is");
});

test("without a description it works out what the doodle shows", () => {
  assert.match(doodlePrompt({ style: "cartoon" }), /Work out what the doodle shows from its shapes/);
});

test("a diagram gets labels; More like this asks for a new take", () => {
  const diagram = doodlePrompt({ description: "a plant cell", style: "diagram" });
  assert.match(diagram, /Label the parts in English/);
  assert.doesNotMatch(diagram, /No text, captions/);
  assert.match(doodlePrompt({ style: "photo", again: true }), /This is a new take/);
});

test("the chat says what was asked", () => {
  assert.equal(doodleRequestText({ description: "a cat on a sofa", style: "cartoon" }), "Turn my doodle into a cartoon: a cat on a sofa");
  assert.equal(doodleRequestText({ style: "photo" }), "Turn my doodle into a realistic photo");
  assert.equal(styleOf("nope").id, DOODLE_STYLES[0].id, "an unknown look is the default");
});

test("a finger's path is smoothed into curves through the midpoints", () => {
  assert.deepEqual(smoothSegments([[0, 0]]), []);
  assert.deepEqual(smoothSegments([[0, 0], [10, 0], [10, 10]]), [
    { from: [0, 0], control: [10, 0], to: [10, 5] },
    { from: [10, 5], control: [10, 10], to: [10, 10] },
  ]);
});

test("rubbing out alone isn't a drawing; a photo is", () => {
  assert.equal(hasDrawing([]), false);
  assert.equal(hasDrawing([{ erase: true, points: [[1, 1], [2, 2]] }]), false);
  assert.equal(hasDrawing([{ erase: false, points: [[1, 1]] }]), true);
  assert.equal(hasDrawing([], { width: 10, height: 10 }), true);
});
