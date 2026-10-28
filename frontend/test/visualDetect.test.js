import test from "node:test";
import assert from "node:assert/strict";

import { detectVisual, mightBeVisual } from "../src/lib/visualDetect.js";

const pie = JSON.stringify({ type: "chart", chartType: "pie", title: "Typical 15-min South Indian Breakfast", data: [{ label: "Pongal", value: 50 }, { label: "Upma", value: 20 }] }, null, 2);
const chartjs = JSON.stringify({ type: "bar", data: { labels: ["A", "B"], datasets: [{ label: "Sales", data: [1, 2] }] } });
const places = JSON.stringify([{ name: "Trichy", lat: 10.79, lng: 78.7 }]);
const quiz = JSON.stringify({ questions: [{ question: "2+2?", options: ["3", "4"], answer: "B" }] });
const choices = JSON.stringify({ question: "Which topic?", options: ["A", "B"] });

test("the app's own visual blocks are drawn whatever they are fenced as", () => {
  for (const tag of ["chart", "json", "graph", "", "text", "pie", "visual"]) {
    assert.equal(mightBeVisual(tag, pie), true, tag);
    assert.equal(detectVisual(tag, pie)?.kind, "structured", tag);
  }
});

test("charts, maps, quizzes and questions under a stray tag are drawn", () => {
  assert.equal(detectVisual("chart", chartjs)?.kind, "chartjs");
  assert.equal(detectVisual("graph", chartjs)?.kind, "chartjs");
  assert.equal(detectVisual("", chartjs)?.kind, "chartjs");
  assert.equal(detectVisual("map", places)?.kind, "map");
  assert.equal(detectVisual("", places)?.kind, "map");
  assert.equal(detectVisual("text", quiz)?.kind, "quiz");
  assert.equal(detectVisual("choice", choices)?.kind, "choices");
  assert.equal(detectVisual("flowchart", "flowchart LR\n  A --> B")?.kind, "mermaid");
  assert.equal(detectVisual("", "graph TD\n  A --> B")?.kind, "mermaid");
});

test("charts, maps and quizzes fenced as ```json are drawn, not shown as raw JSON", () => {
  // The drawn card keeps a Code button for viewing or copying the config.
  assert.equal(detectVisual("json", chartjs)?.kind, "chartjs");
  assert.equal(detectVisual("json", places)?.kind, "map");
  assert.equal(detectVisual("json", quiz)?.kind, "quiz");
});

test("code that isn't a visual stays code", () => {
  assert.equal(detectVisual("javascript", places), null);
  assert.equal(detectVisual("json", JSON.stringify({ name: "app", type: "module" })), null);
  assert.equal(mightBeVisual("python", "x = {\"type\": \"chart\"}"), false);
  assert.equal(mightBeVisual("json", '{"name": "app", "version": "1.0.0"}'), false);
  assert.equal(detectVisual("chart", "{ not json"), null);
});
