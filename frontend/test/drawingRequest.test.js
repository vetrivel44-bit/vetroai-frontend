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

test("an engineering drawing question gets the exact-drawing rules, never a sketch", async () => {
  const { isOrthoRequest, orthoInstruction } = await import("../src/lib/orthoRules.js");
  const question = `ENGINEERING DRAWING PROBLEM: ORTHOGRAPHIC PROJECTION
Object: Machine Block. Base Plate 100×60×15. Vertical web/back wall to a total height of 65, thickness 15.
Central rib 12 thick from 50 mm height on the back wall to 35 mm from the front edge. Through hole Ø24 through the back wall.
Base slot 30 wide × 15 deep at the front centre. Draw in First Angle (BIS): Front View (Arrow X), Top View below, LH Side View to the right.
Show a 45° miter line, hidden lines dashed, centre lines, complete dimensioning and a title block with scale 1:1.`;
  for (const q of [question, "Draw the front view, top view and side view of the given block", "orthographic projection of the bracket", "draw the elevation and plan of a hexagonal prism", "first angle projection of a V-block", "draw the front view of the bearing block with all dimensions in mm"]) {
    assert.ok(isOrthoRequest(q), q);
    assert.ok(isDrawingRequest(q), q);
    assert.match(drawingInstruction(q), /```ortho/);
    assert.match(drawingInstruction(q), /Engineering drawing rules/);
    assert.doesNotMatch(drawingInstruction(q), /Sketch rules/);
  }
  for (const q of ["front view of a car", "draw the human heart", "what is the elevation of Mount Everest", "side view of a horse", "draw a flowchart of the process"]) {
    assert.ok(!isOrthoRequest(q), q);
  }
  const rules = orthoInstruction();
  for (const shape of ['"box"', '"cylinder"', '"prism"', '"cone"', '"pyramid"', '"dims"', '"projection"']) assert.ok(rules.includes(shape), shape);
});
