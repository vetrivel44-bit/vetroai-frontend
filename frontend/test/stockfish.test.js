import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { Chess } from "chess.js";

import { MATE_SCORE } from "../src/utils/chessEngine.js";
import { uciScore, parseInfoLine, positionCommand, extendPosition, createStockfishClient, masterOptions, isMemoryLimited } from "../src/utils/stockfish.js";

test("UCI scores convert to the arena engine's convention", () => {
  assert.equal(uciScore("cp", 35), 35);
  assert.equal(uciScore("cp", -120), -120);
  // Mate in 1 for the side to move is one ply away; being mated in 2 is four.
  assert.equal(uciScore("mate", 1), MATE_SCORE - 1);
  assert.equal(uciScore("mate", 3), MATE_SCORE - 5);
  assert.equal(uciScore("mate", -2), -(MATE_SCORE - 4));
});

test("info lines give a depth and score; bounds and chatter are skipped", () => {
  assert.deepEqual(
    parseInfoLine("info depth 18 seldepth 24 multipv 1 score cp 42 nodes 912345 nps 450000 time 2000 pv e2e4 e7e5"),
    { depth: 18, score: 42 },
  );
  assert.deepEqual(parseInfoLine("info depth 9 seldepth 9 multipv 1 score mate 2 nodes 40 pv d1d8"), { depth: 9, score: MATE_SCORE - 3 });
  assert.equal(parseInfoLine("info depth 20 seldepth 30 multipv 1 score cp 51 lowerbound nodes 1 pv e2e4"), null);
  assert.equal(parseInfoLine("info string NNUE evaluation using nn-61e7af4bb97d.nnue"), null);
  assert.equal(parseInfoLine("info depth 12 currmove e2e4 currmovenumber 1"), null);
  assert.equal(parseInfoLine("bestmove e2e4 ponder e7e5"), null);
});

test("the position command replays the game so repetitions are visible", () => {
  const chess = new Chess();
  assert.equal(positionCommand(chess), `position fen ${chess.fen()}`);
  for (const san of ["Nf3", "Nf6", "Ng1", "Ng8"]) chess.move(san);
  assert.equal(positionCommand(chess), "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves g1f3 g8f6 f3g1 f6g8");

  // A game set up from a FEN starts from that FEN, and promotions keep their piece.
  const fen = "8/P6k/8/8/8/8/6K1/8 w - - 0 1";
  const promo = new Chess(fen);
  promo.move("a8=Q");
  assert.equal(positionCommand(promo), `position fen ${fen} moves a7a8q`);
});

// A stand-in worker that answers the way Stockfish does.
function fakeEngine({ bestmoves = [], silentGo = false } = {}) {
  const sent = [];
  const replies = [...bestmoves];
  const worker = {
    onmessage: null,
    onerror: null,
    terminated: false,
    reply(line) { this.onmessage?.({ data: line }); },
    terminate() { this.terminated = true; },
    postMessage(cmd) {
      sent.push(cmd);
      queueMicrotask(() => {
        if (cmd === "uci") this.reply("id name Stockfish 19\nuciok");
        else if (cmd === "isready") this.reply("readyok");
        else if (cmd.startsWith("go") && !silentGo) {
          const move = replies.shift() ?? "e2e4";
          this.reply("info depth 5 seldepth 5 multipv 1 score cp 10 nodes 100 pv " + move);
          this.reply("info depth 6 seldepth 7 multipv 1 score cp 25 nodes 300 pv " + move);
          this.pendingBest = move;
          // Like Stockfish, a ponder search answers only after ponderhit or stop.
          if (!this.holdBest && !cmd.startsWith("go ponder")) this.reply(`bestmove ${move}`);
        } else if ((cmd === "stop" || cmd === "ponderhit") && this.pendingBest) {
          this.reply(`bestmove ${this.pendingBest}`);
          this.pendingBest = null;
        }
      });
    },
  };
  return { worker, sent };
}

test("a search returns the best move with the last reported score and depth", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["g1f3"] });
  const client = createStockfishClient(worker);
  const result = await client.search({ position: "position fen x", movetime: 100, newGame: true });
  assert.deepEqual(result, { uci: "g1f3", ponder: null, score: 25, depth: 6 });
  assert.deepEqual(sent, ["uci", "isready", "ucinewgame", "isready", "position fen x", "go movetime 100"]);
});

test("a cancelled search's late bestmove is not taken as the next answer", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["a2a3", "e2e4"] });
  worker.holdBest = true; // answer only once told to stop, like a long think
  const client = createStockfishClient(worker);

  const ctrl = new AbortController();
  const first = client.search({ position: "position fen one", movetime: 5000 }, ctrl.signal);
  await new Promise((r) => setTimeout(r, 10));
  ctrl.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.ok(sent.includes("stop"));

  worker.holdBest = false;
  const second = await client.search({ position: "position fen two", movetime: 100 });
  assert.equal(second.uci, "e2e4");
});

test("an engine that stops answering is reported broken, not waited on forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { worker } = fakeEngine({ silentGo: true });
  const client = createStockfishClient(worker);
  await client.ready;
  const search = client.search({ position: "position fen x", movetime: 100 });
  // Let the queued search reach "go" before the clock moves.
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(100 + 15000);
  await assert.rejects(search, /did not answer/);
  assert.ok(client.broken);
  assert.ok(worker.terminated);
});

test("Master runs at full strength: no skill or Elo limit, one line, cores minus two threads", () => {
  const desktop = masterOptions({ threaded: true, cores: 8, memoryLimited: false });
  assert.equal(desktop.threads, 6);
  assert.equal(desktop.hash, 256);
  assert.deepEqual(desktop.commands, [
    "setoption name Threads value 6",
    "setoption name Hash value 256",
    "setoption name Skill Level value 20",
    "setoption name UCI_LimitStrength value false",
    "setoption name MultiPV value 1",
    "setoption name Ponder value true",
  ]);
  assert.equal(masterOptions({ threaded: true, cores: 2, memoryLimited: false }).threads, 1);
  assert.equal(masterOptions({ threaded: true, cores: null, memoryLimited: false }).threads, 1); // core count unknown
  // The single-threaded build ignores Threads; it is told 1.
  assert.equal(masterOptions({ threaded: false, cores: 16, memoryLimited: false }).threads, 1);
  assert.equal(masterOptions({ threaded: true, cores: 8, memoryLimited: true }).hash, 128);
});

test("memory counts as limited on a phone or a device reporting 4 GB or less", () => {
  assert.equal(isMemoryLimited({ deviceMemory: 4, userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), true);
  assert.equal(isMemoryLimited({ deviceMemory: 8, userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" }), false);
  assert.equal(isMemoryLimited({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isMemoryLimited({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true); // iPad
  assert.equal(isMemoryLimited({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }), false);
  assert.equal(isMemoryLimited(undefined), false);
});

test("options are sent before the next search and confirmed with isready", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["e2e4"] });
  const client = createStockfishClient(worker);
  await client.configure(["setoption name Hash value 256", "setoption name Threads value 6"]);
  await client.search({ position: "position fen x", movetime: 100 });
  assert.deepEqual(sent, ["uci", "isready", "setoption name Hash value 256", "setoption name Threads value 6", "isready", "position fen x", "go movetime 100"]);
});

test("a position extends with the engine's move and the reply it expects", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(extendPosition(`position fen ${fen}`, ["e2e4", "e7e5"]), `position fen ${fen} moves e2e4 e7e5`);
  assert.equal(extendPosition(`position fen ${fen} moves d2d4`, ["d7d5", "c2c4"]), `position fen ${fen} moves d2d4 d7d5 c2c4`);

  // The same string positionCommand gives once both moves are played.
  const chess = new Chess();
  const before = positionCommand(chess);
  chess.move("e4"); chess.move("e5");
  assert.equal(extendPosition(before, ["e2e4", "e7e5"]), positionCommand(chess));
});

test("the move it expected: ponderhit, and the ponder search is the answer", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["e2e4 ponder e7e5", "g1f3 ponder b8c6"] });
  const client = createStockfishClient(worker);
  const first = await client.search({ position: "position fen F", movetime: 100 });
  assert.deepEqual(first, { uci: "e2e4", ponder: "e7e5", score: 25, depth: 6 });

  await client.ponder({ position: "position fen F moves e2e4 e7e5", movetime: 100 });
  const reply = await client.search({ position: "position fen F moves e2e4 e7e5", movetime: 100 });
  assert.equal(reply.uci, "g1f3");
  assert.equal(reply.pondered, true);
  assert.deepEqual(sent.slice(-3), ["position fen F moves e2e4 e7e5", "go ponder movetime 100", "ponderhit"]);
});

test("another move: the ponder search is stopped, its answer dropped, the real position searched", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["g1f3 ponder b8c6", "d2d4 ponder d7d5"] });
  const client = createStockfishClient(worker);
  await client.ponder({ position: "position fen F moves e2e4 e7e5", movetime: 100 });
  const reply = await client.search({ position: "position fen F moves e2e4 c7c5", movetime: 100 });
  assert.equal(reply.uci, "d2d4"); // not the pondered g1f3
  assert.equal(reply.pondered, undefined);
  assert.deepEqual(sent.slice(-5), ["position fen F moves e2e4 e7e5", "go ponder movetime 100", "stop", "position fen F moves e2e4 c7c5", "go movetime 100"]);
});

test("a new game or the end of one stops the ponder search first", async () => {
  const { worker, sent } = fakeEngine({ bestmoves: ["g1f3", "e2e4"] });
  const client = createStockfishClient(worker);
  await client.ponder({ position: "position fen A", movetime: 100 });
  await client.stopPondering();
  assert.equal(sent.at(-1), "stop");
  await client.stopPondering(); // nothing to stop: sends nothing
  assert.equal(sent.at(-1), "stop");

  await client.ponder({ position: "position fen A", movetime: 100 });
  // Same position, but a new game: never a ponderhit across games.
  await client.search({ position: "position fen A", movetime: 100, newGame: true });
  assert.deepEqual(sent.slice(-7), ["position fen A", "go ponder movetime 100", "stop", "ucinewgame", "isready", "position fen A", "go movetime 100"]);
  assert.ok(!sent.includes("ponderhit"));
});
