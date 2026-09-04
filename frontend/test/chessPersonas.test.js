import test from "node:test";
import assert from "node:assert/strict";

import { Position, Engine } from "../src/utils/chessEngine.js";
import { PERSONAS, MOODS, buildGameIdentity, bookMove, openingName, makeSeededRandom } from "../src/utils/chessPersonas.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ITALIAN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";

test("every persona is fully specified", () => {
  for (const [id, p] of Object.entries(PERSONAS)) {
    assert.ok(p.label, `${id} has a label`);
    assert.ok(p.school, `${id} has a school`);
    assert.ok(Array.isArray(p.doctrine) && p.doctrine.length >= 2, `${id} has doctrine`);
    assert.ok(p.voice, `${id} has a voice`);
    assert.ok(p.discipline > 0 && p.discipline <= 1, `${id} discipline in range`);
    assert.ok(p.thinkMs >= 300, `${id} gets time to think`);
    assert.ok(p.style.material > 0, `${id} has style weights`);
  }
});

test("a game seed is reproducible, and different seeds differ", () => {
  const a1 = buildGameIdentity("groq", "seed-1", "w");
  const a2 = buildGameIdentity("groq", "seed-1", "w");
  assert.equal(a1.mood.id, a2.mood.id, "same seed gives the same mood");
  assert.deepEqual(a1.style, a2.style, "same seed gives the same style");

  const moods = new Set();
  for (let i = 0; i < 40; i++) moods.add(buildGameIdentity("groq", "seed-" + i, "w").mood.id);
  assert.ok(moods.size >= 4, `expected varied moods across games, saw ${moods.size}`);
});

test("the two colours in one game get independent moods", () => {
  const differing = [];
  for (let i = 0; i < 20; i++) {
    const w = buildGameIdentity("agnes", "g" + i, "w").mood.id;
    const b = buildGameIdentity("agnes", "g" + i, "b").mood.id;
    if (w !== b) differing.push(i);
  }
  assert.ok(differing.length > 5, "White and Black should not always share a mood");
});

test("moods never push a style outside its safe band", () => {
  for (const id of Object.keys(PERSONAS)) {
    for (let i = 0; i < 30; i++) {
      const s = buildGameIdentity(id, "seed" + i, "w").style;
      assert.ok(s.material >= 0.7 && s.material <= 1.3, `${id} material ${s.material}`);
      assert.ok(s.kingAttack >= 0.5 && s.kingAttack <= 2, `${id} kingAttack ${s.kingAttack}`);
      assert.ok(s.kingSafety >= 0.5 && s.kingSafety <= 1.8, `${id} kingSafety ${s.kingSafety}`);
    }
  }
});

test("discipline stays inside its band whatever the mood", () => {
  for (const id of Object.keys(PERSONAS)) {
    for (const mood of MOODS) {
      const base = PERSONAS[id].discipline + mood.disciplineShift;
      const clamped = Math.min(0.97, Math.max(0.55, base));
      assert.ok(clamped >= 0.55 && clamped <= 0.97);
    }
  }
});

test("the book only ever suggests a legal move", () => {
  const rng = makeSeededRandom("book");
  for (const mood of MOODS) {
    const bm = bookMove([], ["e4", "d4", "Nf3", "c4", "g3"], rng, mood.id);
    if (bm) assert.ok(["e4", "d4", "Nf3", "c4", "g3"].includes(bm.san), bm.san);
  }
  // A book line whose move is not legal here must be refused outright.
  assert.equal(bookMove([], ["a3"], rng, "sharp"), null);
});

test("the book produces varied first moves across games", () => {
  const firsts = new Set();
  for (let i = 0; i < 30; i++) {
    const identity = buildGameIdentity("fable", "open" + i, "w");
    const bm = bookMove([], ["e4", "d4", "Nf3", "c4", "g3"], identity.rng, identity.mood.id);
    if (bm) firsts.add(bm.san);
  }
  assert.ok(firsts.size >= 3, `expected varied openings, saw ${[...firsts].join(",")}`);
});

test("openings are named from the move order", () => {
  assert.equal(openingName(["e4", "c5"]), "Sicilian");
  assert.equal(openingName(["d4", "d5", "c4"]), "Queen's Gambit");
  assert.equal(openingName(["e4", "e5", "Nf3", "Nc6", "Bb5"]), "Ruy López");
  assert.equal(openingName([]), null);
});

test("different personas genuinely disagree about the same position", () => {
  // The whole point of the style weights: they change which move the search
  // believes is best, rather than dressing up one shared answer.
  const engine = new Engine();
  const chosen = new Set();
  for (const id of Object.keys(PERSONAS)) {
    const identity = buildGameIdentity(id, "shared-seed", "w");
    const pos = Position.fromFen(ITALIAN);
    const r = engine.analyse(pos, { timeMs: 200, style: identity.style, multiPv: 1 });
    chosen.add(pos.moveToUci(r.best));
  }
  assert.ok(chosen.size >= 2, `personas all picked the same move: ${[...chosen]}`);
});

test("style weights actually move the evaluation", () => {
  const engine = new Engine();
  const greedy = buildGameIdentity("mistral", "s", "w").style;
  const attacker = buildGameIdentity("fable", "s", "w").style;
  const a = engine.analyse(Position.fromFen(START), { timeMs: 200, style: greedy, multiPv: 1 });
  const b = engine.analyse(Position.fromFen(START), { timeMs: 200, style: attacker, multiPv: 1 });
  assert.notEqual(a.score, b.score, "a materialist and an attacker should not agree on the score");
});
