import test from "node:test";
import assert from "node:assert/strict";

import { askSearchIntent } from "../src/lib/searchIntent.js";

const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test("browser models follow the server's decision", async () => {
  assert.equal(await askSearchIntent("/api", { query: "I am happy" }, { fetchImpl: reply({ data: { search: false, by: "model" } }), fallback: () => true }), false);
  assert.equal(await askSearchIntent("/api", { query: "rbi repo rate" }, { fetchImpl: reply({ data: { search: true, by: "model" } }), fallback: () => false }), true);
});

test("if the server can't decide, the local word list does", async () => {
  const down = async () => { throw new Error("offline"); };
  assert.equal(await askSearchIntent("/api", { query: "x" }, { fetchImpl: down, fallback: () => true }), true);
  assert.equal(await askSearchIntent("/api", { query: "x" }, { fetchImpl: reply({}, false), fallback: () => false }), false);
  assert.equal(await askSearchIntent("/api", { query: "x" }, { fetchImpl: reply({ data: {} }), fallback: () => true }), true);
});

test("it sends the question, mode, timezone and the last four turns", async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ data: { search: true } }) }; };
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }));
  await askSearchIntent("https://api.example", { query: "and in 2025?", history, mode: "normal", timeZone: "Asia/Kolkata" }, { fetchImpl });
  assert.equal(sent.url, "https://api.example/search-intent");
  assert.equal(sent.body.query, "and in 2025?");
  assert.equal(sent.body.timeZone, "Asia/Kolkata");
  assert.deepEqual(sent.body.history.map((m) => m.content), ["turn 2", "turn 3", "turn 4", "turn 5"]);
});
