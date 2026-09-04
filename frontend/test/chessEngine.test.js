import test from "node:test";
import assert from "node:assert/strict";

import { Position, Engine, analysePosition, MATE_SCORE, DEFAULT_STYLE } from "../src/utils/chessEngine.js";

function perft(pos, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const m of pos.generateMoves(false)) {
    if (!pos.makeMove(m)) continue;
    nodes += perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return nodes;
}

// The move generator is the foundation for everything else here: a wrong one
// would make the arena play worse than the random fallback it replaced. These
// are the standard positions from the Chess Programming Wiki, chosen because
// between them they cover castling, en passant, promotion, pins and checks.
const PERFT_SUITE = [
  { name: "start position", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", counts: [20, 400, 8902, 197281] },
  { name: "kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", counts: [48, 2039, 97862] },
  { name: "endgame with pins", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", counts: [14, 191, 2812, 43238] },
  { name: "promotions", fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", counts: [6, 264, 9467] },
  { name: "tangled middlegame", fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", counts: [44, 1486, 62379] },
  { name: "open position", fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", counts: [46, 2079, 89890] },
];

for (const { name, fen, counts } of PERFT_SUITE) {
  test(`perft matches known node counts: ${name}`, () => {
    counts.forEach((expected, i) => {
      const pos = Position.fromFen(fen);
      assert.equal(perft(pos, i + 1), expected, `depth ${i + 1}`);
    });
  });
}

test("make/unmake restores the position exactly", () => {
  const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
  const pos = Position.fromFen(fen);
  const before = { board: Array.from(pos.board), castling: pos.castling, ep: pos.epSquare, key: pos.key, lock: pos.lock };

  for (const move of pos.generateMoves(false)) {
    if (!pos.makeMove(move)) continue;
    pos.unmakeMove();
    assert.deepEqual(Array.from(pos.board), before.board, "board restored");
    assert.equal(pos.castling, before.castling, "castling rights restored");
    assert.equal(pos.epSquare, before.ep, "en passant square restored");
    assert.equal(pos.key, before.key, "zobrist key restored");
    assert.equal(pos.lock, before.lock, "zobrist lock restored");
  }
});

test("zobrist key is recomputable from scratch after a move", () => {
  const pos = Position.fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  for (const move of pos.generateMoves(false).slice(0, 12)) {
    if (!pos.makeMove(move)) continue;
    const incremental = { key: pos.key, lock: pos.lock };
    pos.computeKey();
    assert.equal(pos.key, incremental.key, "incremental key matches full recompute");
    assert.equal(pos.lock, incremental.lock, "incremental lock matches full recompute");
    pos.unmakeMove();
  }
});

test("finds mate in one", () => {
  const r = analysePosition("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", { timeMs: 300 });
  assert.equal(r.bestUci, "a1a8");
  assert.ok(r.score > MATE_SCORE - 100, `expected a mate score, got ${r.score}`);
});

test("finds a smothered mate in one", () => {
  const r = analysePosition("6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", { timeMs: 300 });
  assert.equal(r.bestUci, "g5f7");
  assert.ok(r.score > MATE_SCORE - 100);
});

test("takes a free rook", () => {
  const r = analysePosition("4k3/8/8/8/8/8/4r3/4K2R w K - 0 1", { timeMs: 400 });
  assert.equal(r.bestUci, "e1e2");
  assert.ok(r.score > 300, `expected a winning score, got ${r.score}`);
});

test("does not hang a queen for nothing", () => {
  // White queen on d1, black queen on d8, open d-file. Qxd8 loses the queen
  // to the king recapture; the engine must not choose it.
  const r = analysePosition("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1", { timeMs: 400, multiPv: 6 });
  assert.notEqual(r.bestUci, "d1d8");
});

test("candidate lines carry distinct, ordered evaluations", () => {
  // A root that returns bounds rather than true scores would make every
  // candidate look equal, and the whole tactical brief handed to the models
  // would be meaningless.
  const r = analysePosition("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5", { timeMs: 500, multiPv: 4 });
  assert.ok(r.lines.length >= 3, "expected several candidate lines");
  const scores = r.lines.map((l) => l.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "lines are best-first");
  assert.ok(new Set(scores).size > 1, "candidates must not all share one score");
});

test("reports checkmate and stalemate as terminal", () => {
  const mated = analysePosition("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", { timeMs: 100 });
  assert.equal(mated.bestUci, null);
  assert.equal(mated.score, -MATE_SCORE);

  const stalemate = analysePosition("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { timeMs: 100 });
  assert.equal(stalemate.bestUci, null);
  assert.equal(stalemate.score, 0);
});

test("prefers castling to a rook shuffle that forfeits it", () => {
  // Without the castling-rights term the rook's piece-square table made Rf1
  // look like a gain while quietly throwing away the right to castle.
  const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";
  const engine = new Engine();
  const pos = Position.fromFen(fen);
  const r = engine.analyse(pos, { timeMs: 600, style: DEFAULT_STYLE, multiPv: 30 });
  const byUci = new Map(r.lines.map((l) => [pos.moveToUci(l.move), l.score]));
  const castle = byUci.get("e1g1");
  const shuffle = byUci.get("h1f1");
  if (castle !== undefined && shuffle !== undefined) {
    assert.ok(castle > shuffle, `castling (${castle}) should beat Rf1 (${shuffle})`);
  }
});

test("every move it returns is legal, over a whole self-played game", async () => {
  const { Chess } = await import("chess.js");
  const c = new Chess();
  let plies = 0;
  while (!c.isGameOver() && plies < 60) {
    const r = analysePosition(c.fen(), { timeMs: 40 });
    assert.ok(r.bestUci, `no move returned for ${c.fen()}`);
    const from = r.bestUci.slice(0, 2), to = r.bestUci.slice(2, 4), promotion = r.bestUci.slice(4);
    const played = c.move(promotion ? { from, to, promotion } : { from, to });
    assert.ok(played, `illegal move ${r.bestUci} in ${c.fen()}`);
    plies++;
  }
  assert.ok(plies > 20, "expected a real game, not an immediate stall");
});
