import test from "node:test";
import assert from "node:assert/strict";

import { VETRO_CHOICES, pickVetroChoice } from "../src/lib/vetroChoice.js";

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};

test("the pool is varied, not just summaries", () => {
  assert.ok(VETRO_CHOICES.length >= 30);
  assert.ok(VETRO_CHOICES.every((p) => !/^summari[sz]e/i.test(p)));
  assert.equal(new Set(VETRO_CHOICES).size, VETRO_CHOICES.length);
});

test("consecutive picks don't repeat within the last 15", () => {
  const storage = memoryStorage();
  const picks = Array.from({ length: 15 }, () => pickVetroChoice({ storage }));
  assert.equal(new Set(picks).size, 15);
});

test("works when storage is unavailable", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.ok(VETRO_CHOICES.includes(pickVetroChoice({ storage: broken })));
  assert.ok(VETRO_CHOICES.includes(pickVetroChoice({ storage: null })));
});

test("Life stuff draws from its own everyday pool and keeps its own history", async () => {
  const { LIFE_CHOICES, pickLifeChoice } = await import("../src/lib/vetroChoice.js");
  assert.ok(LIFE_CHOICES.length >= 30);
  assert.equal(new Set(LIFE_CHOICES).size, LIFE_CHOICES.length);
  assert.ok(LIFE_CHOICES.every((p) => !VETRO_CHOICES.includes(p)));
  const storage = memoryStorage();
  const life = Array.from({ length: 15 }, () => pickLifeChoice({ storage }));
  assert.equal(new Set(life).size, 15);
  assert.ok(life.every((p) => LIFE_CHOICES.includes(p)));
  assert.ok(VETRO_CHOICES.includes(pickVetroChoice({ storage })));
});
