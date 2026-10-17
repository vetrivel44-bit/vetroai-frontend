import test from "node:test";
import assert from "node:assert/strict";
import { drawingInstruction, isDrawingRequest } from "../src/lib/drawingRequest.js";

test("asking to draw a thing is a drawing; a process or data stays a flowchart or chart", () => {
  for (const q of ["Give a hand drawn diagram of brain", "draw the human heart", "Draw a diagram of the eye", "labelled diagram of a flower", "sketch a volcano", "draw a circuit with two bulbs", "hand-drawn picture of a house"]) {
    assert.ok(isDrawingRequest(q), q);
  }
  for (const q of ["draw a flowchart of photosynthesis", "diagram of the steps of mitosis", "draw a mind map of WW2", "sequence diagram for login", "hand drawn flow chart of the water cycle process", "draw a bar chart of sales data", "what is the capital of France"]) {
    assert.ok(!isDrawingRequest(q), q);
  }
});

test("the instruction asks for a sketch, rules included, and rules out a flowchart", () => {
  const s = drawingInstruction("hand drawn diagram of brain");
  assert.match(s, /```sketch/);
  assert.match(s, /Sketch rules/);
  assert.match(s, /Do NOT answer with a flowchart/);
  assert.match(s, /hand drawn diagram of brain/);
});
