// Chess Arena — Stockfish for the Master level, and for AI vs AI.
//
// The arena's own engine (chessEngine.js) plays like a strong club player,
// which is not what "Master" promises: a determined player, or a language
// model coached move by move, could still beat it. Master runs the full
// Stockfish 19 build (stockfishFull.js), and falls back to the lite,
// single-threaded build from stockfish.js (public/stockfish/, GPLv3, see
// Copying.txt there) if the full one can't load. AI vs AI and Spectator play
// the lite build: it is under 2 MB and still far stronger than any human.
//
// The engine runs in its own Web Worker and speaks UCI, one line per message.
// Searches are queued: a cancelled search still answers with a "bestmove"
// after "stop", and the queue makes sure that late answer is never read as
// the reply to the next search.

import { MATE_SCORE } from "./chessEngine.js";
import { loadFullEngine, markFullEngineFailed, markFullEngineReady } from "./stockfishFull.js";

export const STOCKFISH_URL = `${import.meta.env?.BASE_URL ?? "/"}stockfish/stockfish-19-lite-single.js`;

const READY_TIMEOUT_MS = 20000; // a cold download on a slow phone connection
// The full build is already downloaded when its worker starts, but compiling
// 94 MiB of WebAssembly takes a while on a phone.
const FULL_READY_TIMEOUT_MS = 120000;
// How long Master's move waits for a full engine that is still downloading
// before playing this one move with the lite build.
const FULL_WAIT_MS = 15000;
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
export function createStockfishClient(worker, { readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
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

  const ready = exchange("uci", (line) => line === "uciok", readyTimeoutMs)
    .then(() => exchange("isready", (line) => line === "readyok", readyTimeoutMs));
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

// ─── the arena's engines ────────────────────────────────────────────────────
// "lite": lite-single, for AI vs AI and Spectator, and Master's fallback.
// "full": the full build (stockfishFull.js), for Master.
const engines = new Map(); // kind → Promise<client | false>; false = can't run here
const lastGame = new Map(); // kind → gameSeed of its last search

function startEngine(kind) {
  if (typeof Worker === "undefined") return Promise.resolve(false);
  if (kind === "full") {
    return loadFullEngine()
      .then(async ({ worker, release }) => {
        const engine = createStockfishClient(worker, { readyTimeoutMs: FULL_READY_TIMEOUT_MS });
        try { await engine.ready; } finally { release(); }
        markFullEngineReady();
        return engine;
      })
      .catch((err) => {
        markFullEngineFailed(err);
        return false;
      });
  }
  try {
    const engine = createStockfishClient(new Worker(STOCKFISH_URL));
    return engine.ready.then(() => engine, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

function getEngine(kind) {
  if (!engines.has(kind)) engines.set(kind, startEngine(kind));
  return engines.get(kind);
}

// Starts the download early, so the first move off the opening book doesn't
// wait for it. Master warms up "full" as soon as it is picked.
export function warmUpStockfish(kind = "lite") {
  if (typeof Worker !== "undefined") getEngine(kind);
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// The engine to search with: "full" if it is ready (waiting up to
// FULL_WAIT_MS for one still loading), otherwise "lite". `fallback` says why
// a Master move is played by the lite build.
async function pickEngine(kind, signal) {
  if (kind !== "full") return { kind, engine: await abortable(getEngine(kind), signal), fallback: null };
  let timer;
  const stillLoading = new Promise((resolve) => { timer = setTimeout(() => resolve("loading"), FULL_WAIT_MS); });
  const waited = await abortable(Promise.race([getEngine("full"), stillLoading]), signal).finally(() => clearTimeout(timer));
  if (waited && waited !== "loading") return { kind: "full", engine: waited, fallback: null };
  return { kind: "lite", engine: await abortable(getEngine("lite"), signal), fallback: waited === "loading" ? "loading" : "failed" };
}

// Stockfish's move for the position in `chess` — { uci, score, depth, engine,
// fallback } — or null when Stockfish can't run here (no WebAssembly, the
// download failed) and the caller should use the arena engine instead.
// Throws an AbortError when `signal` fires.
export async function stockfishMove(chess, { movetime, signal, gameSeed, engine: wanted = "lite" }) {
  if (typeof Worker === "undefined") return null;
  const { kind, engine, fallback } = await pickEngine(wanted, signal);
  if (!engine) return null;
  const newGame = gameSeed !== lastGame.get(kind);
  lastGame.set(kind, gameSeed);
  try {
    const result = await engine.search({ position: positionCommand(chess), movetime, newGame }, signal);
    return result && { ...result, engine: kind, fallback };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    engines.set(kind, Promise.resolve(false));
    // The full engine stopped working mid-game: the lite build takes over.
    if (kind === "full") {
      markFullEngineFailed(err);
      const result = await stockfishMove(chess, { movetime, signal, gameSeed, engine: "lite" });
      return result && { ...result, fallback: "failed" };
    }
    return null;
  }
}
