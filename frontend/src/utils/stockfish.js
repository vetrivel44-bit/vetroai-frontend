// Chess Arena — Stockfish for the Master level.
//
// The arena's own engine (chessEngine.js) plays like a strong club player,
// which is not what "Master" promises: a determined player, or a language
// model coached move by move, could still beat it. Master runs Stockfish 19
// instead — the lite, single-threaded WebAssembly build from stockfish.js
// (public/stockfish/, GPLv3, see Copying.txt there). It needs no special
// headers, is under 2 MB, and is still far stronger than any human.
//
// The engine runs in its own Web Worker and speaks UCI, one line per message.
// Searches are queued: a cancelled search still answers with a "bestmove"
// after "stop", and the queue makes sure that late answer is never read as
// the reply to the next search.

import { MATE_SCORE } from "./chessEngine.js";

export const STOCKFISH_URL = `${import.meta.env?.BASE_URL ?? "/"}stockfish/stockfish-19-lite-single.js`;

const READY_TIMEOUT_MS = 20000; // a cold download on a slow phone connection
const SEARCH_GRACE_MS = 15000; // past movetime before the worker is given up on

function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

// UCI scores are from the side to move; "mate 3" means mate in three moves.
// Converted to the arena engine's convention so the rest of the arena (the
// eval bar, the commentary) reads them the same way.
export function uciScore(kind, value) {
  if (kind === "mate") return value > 0 ? MATE_SCORE - (2 * value - 1) : -(MATE_SCORE + 2 * value);
  return value;
}

// "info depth 18 ... score cp 35 ... pv e2e4 ..." → { depth, score }.
// Bound lines are an aspiration window failing, not a result, so they are
// skipped; so is anything without a score ("info string", currmove lines).
export function parseInfoLine(line) {
  if (!line.startsWith("info ") || / (lower|upper)bound\b/.test(line)) return null;
  const score = line.match(/ score (cp|mate) (-?\d+)/);
  const depth = line.match(/ depth (\d+)/);
  if (!score || !depth) return null;
  return { depth: Number(depth[1]), score: uciScore(score[1], Number(score[2])) };
}

// The whole game since the last position set up from a FEN, so Stockfish
// sees which positions would repeat — it steers away from a threefold draw
// when it is winning.
export function positionCommand(chess) {
  const moves = chess.history({ verbose: true });
  if (!moves.length) return `position fen ${chess.fen()}`;
  return `position fen ${moves[0].before} moves ${moves.map((m) => m.lan).join(" ")}`;
}

// Wraps anything worker-shaped: postMessage(string) in, onmessage({ data })
// out. The arena passes a real Worker; tests pass a stand-in.
export function createStockfishClient(worker) {
  const listeners = new Set();
  let broken = null;

  const fail = (err) => {
    if (broken) return;
    broken = err;
    for (const listener of [...listeners]) listener(null, err);
    listeners.clear();
    try { worker.terminate?.(); } catch { /* already gone */ }
  };

  worker.onmessage = (event) => {
    const text = typeof event === "string" ? event : event?.data;
    if (typeof text !== "string") return; // download progress, not UCI
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line) for (const listener of [...listeners]) listener(line);
    }
  };
  worker.onerror = () => fail(new Error("Stockfish worker failed"));

  // Sends `command` and resolves with the first line `done` accepts.
  function exchange(command, done, timeoutMs) {
    if (broken) return Promise.reject(broken);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        const err = new Error(`Stockfish did not answer "${command}"`);
        reject(err);
        fail(err);
      }, timeoutMs);
      const listener = (line, err) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        if (!done(line)) return;
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(line);
      };
      listeners.add(listener);
      worker.postMessage(command);
    });
  }

  const ready = exchange("uci", (line) => line === "uciok", READY_TIMEOUT_MS)
    .then(() => exchange("isready", (line) => line === "readyok", READY_TIMEOUT_MS));
  ready.catch(() => {});

  let queue = Promise.resolve();

  async function runSearch({ position, movetime, newGame }, signal) {
    await ready;
    if (signal?.aborted) return null;
    if (newGame) {
      worker.postMessage("ucinewgame");
      await exchange("isready", (line) => line === "readyok", READY_TIMEOUT_MS);
    }
    worker.postMessage(position);
    let last = null;
    const onAbort = () => worker.postMessage("stop");
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const line = await exchange(`go movetime ${movetime}`, (l) => {
        const info = parseInfoLine(l);
        if (info) last = info;
        return l.startsWith("bestmove");
      }, movetime + SEARCH_GRACE_MS);
      const uci = line.split(/\s+/)[1];
      if (!uci || uci === "(none)") return null;
      return { uci, score: last?.score ?? 0, depth: last?.depth ?? 0 };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    get broken() { return broken; },
    ready,
    // Resolves to { uci, score, depth } (score from the side to move), or
    // null when there is no move. Rejects with an AbortError when `signal`
    // fires and with an Error when the engine has stopped working.
    search(request, signal) {
      const job = queue.then(() => (signal?.aborted ? null : runSearch(request, signal)));
      queue = job.catch(() => {});
      return job.then((result) => {
        if (signal?.aborted) throw abortError();
        return result;
      });
    },
  };
}

// ─── the arena's one engine ──────────────────────────────────────────────────
let client = null; // null = not started, false = unavailable in this browser
let lastGame = null;

function getClient() {
  if (client !== null) return client;
  try {
    client = createStockfishClient(new Worker(STOCKFISH_URL));
    client.ready.catch(() => { client = false; });
  } catch {
    client = false;
  }
  return client;
}

// Starts the download early, so the first move off the opening book doesn't
// wait for it.
export function warmUpStockfish() {
  if (typeof Worker !== "undefined") getClient();
}

// Stockfish's move for the position in `chess`, or null when Stockfish can't
// run here (no WebAssembly, the download failed) and the caller should use
// the arena engine instead. Throws an AbortError when `signal` fires.
export async function stockfishMove(chess, { movetime, signal, gameSeed }) {
  const engine = typeof Worker !== "undefined" ? getClient() : false;
  if (!engine) return null;
  const newGame = gameSeed !== lastGame;
  lastGame = gameSeed;
  try {
    return await engine.search({ position: positionCommand(chess), movetime, newGame }, signal);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    client = false;
    return null;
  }
}
