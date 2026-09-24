import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";

import { GRANDMASTER_LINES, grandmasterBookMove, repertoireName } from "../src/utils/chessOpenings.js";

test("every repertoire line is legal chess from the start position", () => {
  for (const line of GRANDMASTER_LINES) {
    const c = new Chess();
    for (const san of line.moves.split(" ")) {
      let played = null;
      try { played = c.move(san); } catch { played = null; }
      assert.ok(played, `${line.name}: illegal move ${san} after ${c.history().join(" ")}`);
      // Stored SAN must match chess.js exactly, or the book can never match history.
      assert.equal(played.san, san, `${line.name}: write ${played.san}, not ${san}`);
    }
    assert.ok(c.history().length >= 16, `${line.name} is deep enough`);
  }
});

test("the book follows a line and stops once the game leaves it", () => {
  const c = new Chess();
  const rng = () => 0.3;
  for (let i = 0; i < 12; i++) {
    const bm = grandmasterBookMove(c.history(), c.moves(), rng);
    assert.ok(bm, `book move at ply ${i}`);
    c.move(bm.san);
  }
  assert.equal(grandmasterBookMove(["a3", "h6"], ["e4"], rng), null);
});

test("the book varies across games", () => {
  const firsts = new Set();
  for (let i = 0; i < 40; i++) firsts.add(grandmasterBookMove([], new Chess().moves(), () => i / 40).san);
  assert.ok(firsts.size >= 3, [...firsts].join(","));
});

test("repertoire names get more specific as the game commits", () => {
  assert.equal(repertoireName(["e4", "c5"]), "Sicilian Defence");
  assert.equal(repertoireName("e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6".split(" ")), "Sicilian Dragon, Yugoslav Attack");
  assert.equal(repertoireName(["h4"]), null);
});
