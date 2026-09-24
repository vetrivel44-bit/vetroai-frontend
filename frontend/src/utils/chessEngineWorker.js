// Runs the arena engine off the main thread. A search of several seconds (the
// Hard and Master levels) would otherwise freeze the whole page — no board
// animation, no taps — for as long as the AI thinks.
import { analysePosition, evaluateMove } from "./chessEngine.js";

self.onmessage = ({ data }) => {
  const { id, type, fen, uci, options } = data || {};
  try {
    let result;
    if (type === "analyse") result = analysePosition(fen, options);
    else if (type === "evaluate") result = evaluateMove(fen, uci, options);
    else throw new Error(`Unknown engine request: ${type}`);
    // Moves are internal integers; only the UCI strings and scores cross over.
    if (type === "analyse") result = { depth: result.depth, score: result.score, bestUci: result.bestUci, lines: result.lines, nodes: result.nodes };
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
