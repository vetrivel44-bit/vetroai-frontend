import { test } from "node:test";
import assert from "node:assert/strict";
import { autoModeFor } from "../src/lib/autoMode.js";

const file = (name) => ({ name });

test("everyday messages stay in chat (search is decided separately)", () => {
  for (const q of ["hi", "who won the ipl yesterday", "explain photosynthesis simply", "list all tamil nadu chief ministers"]) {
    assert.equal(autoModeFor({ query: q }), "normal", q);
  }
});

test("research requests get DeepSearch", () => {
  assert.equal(autoModeFor({ query: "Do a deep research on EV battery recycling in India" }), "deep_search");
  assert.equal(autoModeFor({ query: "comprehensive report on the Indian semiconductor market with sources" }), "deep_search");
  assert.equal(autoModeFor({ query: "market analysis of electric scooters in Chennai" }), "deep_search");
});

test("code gets the Code workflow", () => {
  assert.equal(autoModeFor({ query: "write a python function to reverse a linked list" }), "debugger");
  assert.equal(autoModeFor({ query: "why does this fail?\n```js\nconst a = b.c;\n```" }), "debugger");
  assert.equal(autoModeFor({ query: "TypeError: Cannot read properties of undefined (reading 'map')" }), "debugger");
});

test("data files and data questions get Data Analysis", () => {
  assert.equal(autoModeFor({ query: "what stands out?", files: [file("sales_2026.xlsx")] }), "analyst");
  assert.equal(autoModeFor({ query: "analyze this sales data and show the trends" }), "analyst");
});

test("summaries of documents and long text get Summarize", () => {
  assert.equal(autoModeFor({ query: "summarize this", files: [file("policy.pdf")] }), "summarize");
  assert.equal(autoModeFor({ query: "give me the key points: " + "lorem ipsum ".repeat(200) }), "summarize");
  assert.equal(autoModeFor({ query: "summary of the csv please", files: [file("data.csv")] }), "summarize");
});

test("the web search toggle still forces a search", () => {
  assert.equal(autoModeFor({ query: "write a python function", forced: "web_search" }), "web_search");
  assert.equal(autoModeFor({ query: "hi", forced: "debugger" }), "normal", "only the search toggle is honoured");
});
