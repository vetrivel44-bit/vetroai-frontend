// Chess Arena — AI move engine.
//
// Most models talk to the existing /api/chat endpoint the same way the rest
// of VetroAI does (FormData + SSE). Mistral, Groq, Gemini, and OpenRouter
// instead go through a dedicated /api/chess/move endpoint with its own
// CHESS_*_API_KEY credentials on the backend — completely separate from the
// main chat's provider keys, so wiring chess up never changes chat behavior.
// Either way the request/response loop is self-contained here so the Chess
// Arena screen never touches the main chat session state.
//
// How a move is chosen:
//   1. A local search engine analyses the position with this model's style
//      weights, producing ranked candidates with real evaluations.
//   2. Those candidates, plus a readable board and a tactical brief (hanging
//      pieces, threats, checks), go to the model. Handing it a FEN and a list
//      of legal moves — the old prompt — asked it to do board vision it is bad
//      at; handing it analysis lets it do the judgement it is good at.
//   3. The model's choice is checked against the engine. A move that throws
//      away material or walks into mate is vetoed.
//   4. If the reply can't be parsed, the engine's move is played. This used to
//      fall back to a *random legal move*, which is where most of the weak
//      play came from.

import {
  Position, Engine, analysePosition, SIMPLE_VALUE, MATE_SCORE,
  typeOf, colorOf, WHITE,
} from "./chessEngine.js";
import { buildGameIdentity, bookMove, openingName, getPersona } from "./chessPersonas.js";

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
let baseApi = import.meta.env.PROD ? PRODUCTION_API_BASE : "/api";
const configuredApi = import.meta.env.VITE_API_BASE_URL?.trim();
if (configuredApi) baseApi = configuredApi.replace(/\/+$/, "");
if (baseApi.startsWith("http") && !/\/api$/i.test(baseApi)) baseApi += "/api";
export const CHESS_API = baseApi;

export const CHESS_MODELS = [
  { id: "agnes", name: "Agnes 2.0", tagline: "Universal style — squeezes, then strikes", color: "#3b82f6", avatar: "A" },
  { id: "chatgpt", name: "ChatGPT", tagline: "Classical technician — structure above all", color: "#10a37f", avatar: "C" },
  { id: "fable", name: "Fable", tagline: "Romantic attacker — sacrifices on principle", color: "#f472b6", avatar: "F" },
  { id: "gemini", name: "Gemini", tagline: "Pure calculator — trusts the variation", color: "#8b5cf6", avatar: "G" },
  { id: "groq", name: "Groq", tagline: "Relentless initiative — thrives in chaos", color: "#10b981", avatar: "Q" },
  { id: "mistral", name: "Mistral", tagline: "Prophylactic grinder — stops your plan first", color: "#f97316", avatar: "M" },
  { id: "sambanova", name: "SambaNova", tagline: "Hypermodern — cedes the centre to break it", color: "#ec4899", avatar: "S" },
  { id: "openrouter", name: "OpenRouter", tagline: "Adaptive — borrows whichever school fits", color: "#6366f1", avatar: "O" },
];

// These four run through the dedicated /api/chess/move endpoint (their own
// backend API keys); everything else still goes through the shared /api/chat.
const DEDICATED_CHESS_PROVIDERS = new Set(["mistral", "groq", "gemini", "openrouter"]);

export function getModel(id) {
  return CHESS_MODELS.find((m) => m.id === id) || CHESS_MODELS[0];
}

// A private engine instance so arena analysis never shares a transposition
// table with anything else that might be running.
const arenaEngine = new Engine();

// ─── network ────────────────────────────────────────────────────────────────
function processSSELine(line, state) {
  if (!line.startsWith("data:")) return;
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  const type = event.type || (event.content ? "content" : null);
  const data = event.data ?? event.content;
  if (type === "content" && data) state.text += data;
  else if (type === "clear") state.text = "";
  else if (type === "error" && data) state.error = data;
}

async function fetchAIText(provider, prompt, { temperature = 0.7, maxTokens = 420, signal } = {}) {
  const fd = new FormData();
  fd.append("input", prompt);
  fd.append("provider", provider);
  fd.append("mode", "normal");
  fd.append("temperature", String(temperature));
  fd.append("maxTokens", String(maxTokens));
  fd.append("webSearch", "false");
  fd.append("safeMode", "false");

  const res = await fetch(`${CHESS_API}/chat`, { method: "POST", body: fd, signal });
  if (!res.ok) throw new Error(`Chess AI request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { text: "", error: null };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) processSSELine(line.replace(/\r$/, ""), state);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processSSELine(buffer.replace(/\r$/, ""), state);
  if (state.error) throw new Error(state.error);
  return state.text;
}

async function fetchDedicatedChessText(provider, prompt, { temperature = 0.7, maxTokens = 420, signal } = {}) {
  const res = await fetch(`${CHESS_API}/chess/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, prompt, temperature, maxTokens }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.message || `Chess AI request failed (${res.status})`);
  return body.data?.text || "";
}

// ─── move parsing ───────────────────────────────────────────────────────────
function normalizeMoveToken(s) {
  return String(s || "")
    .trim()
    .replace(/[+#!?]+$/g, "")
    .replace(/^0-0-0$/i, "O-O-O")
    .replace(/^0-0$/i, "O-O")
    .toLowerCase();
}

export function parseMoveFromText(text, legalMoves) {
  if (!text || !legalMoves?.length) return null;
  const legalNorm = legalMoves.map((mv) => ({ mv, norm: normalizeMoveToken(mv) }));

  // The declared move wins. Models now reason before answering, so a move
  // mentioned mid-analysis ("if Nf3 then...") must not be mistaken for the
  // decision — take the LAST MOVE: line, which is the conclusion.
  const declared = [...String(text).matchAll(/MOVE:\s*([^\n\r]+)/gi)];
  if (declared.length) {
    const candNorm = normalizeMoveToken(declared[declared.length - 1][1].split(/[\s,(]/)[0]);
    const exact = legalNorm.find((x) => x.norm === candNorm);
    if (exact) return exact.mv;
  }

  // No usable MOVE: line — scan only the tail, where a conclusion would be,
  // rather than the whole reasoning transcript.
  const tail = String(text).slice(-240).replace(/[+#!?]+/g, " ").toLowerCase();
  const sorted = [...legalNorm].sort((a, b) => b.mv.length - a.mv.length);
  for (const { mv, norm } of sorted) {
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
    if (re.test(tail)) return mv;
  }
  return null;
}

export function extractCommentary(text) {
  if (!text) return "";
  const whyLine = [...String(text).matchAll(/WHY:\s*([^\n\r]+)/gi)];
  if (whyLine.length) return whyLine[whyLine.length - 1][1].trim().slice(0, 220);
  const stripped = String(text).replace(/MOVE:\s*[^\n\r]+/gi, "").trim();
  return stripped.slice(-220);
}

// ─── position brief ─────────────────────────────────────────────────────────
const PIECE_LETTER = { 1: "P", 2: "N", 3: "B", 4: "R", 5: "Q", 6: "K" };

// Models read a diagram far more reliably than they read a FEN string.
function renderBoard(pos) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = `${rank + 1} |`;
    for (let file = 0; file < 8; file++) {
      const piece = pos.board[(rank << 4) | file];
      if (!piece) { row += " ."; continue; }
      const letter = PIECE_LETTER[typeOf(piece)];
      row += " " + (colorOf(piece) === WHITE ? letter : letter.toLowerCase());
    }
    rows.push(row);
  }
  rows.push("   ----------------");
  rows.push("    a b c d e f g h");
  return rows.join("\n");
}

function materialSummary(pos) {
  const counts = pos.pieceCounts();
  let white = 0, black = 0;
  for (let t = 1; t <= 5; t++) {
    white += counts[0][t] * SIMPLE_VALUE[t];
    black += counts[1][t] * SIMPLE_VALUE[t];
  }
  const diff = (white - black) / 100;
  const describe = (c) => ["Q", "R", "B", "N", "P"].map((letter, i) => {
    const type = [5, 4, 3, 2, 1][i];
    const n = counts[c][type];
    return n ? `${n}${letter}` : null;
  }).filter(Boolean).join(" ") || "bare king";
  return {
    text: `White: ${describe(0)}  |  Black: ${describe(1)}`,
    diff,
    label: diff === 0 ? "material is level" : `${diff > 0 ? "White" : "Black"} is up ${Math.abs(diff).toFixed(1)} pawns`,
  };
}

// Pieces that are attacked and either undefended or defended too cheaply.
// This is the single most useful thing to tell a model: most weak engine-free
// play is just missing that something is hanging.
function findLoosePieces(pos, side) {
  const loose = [];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = pos.board[sq];
    if (!piece || colorOf(piece) !== side) continue;
    const type = typeOf(piece);
    if (type === 6) continue; // the king is handled by check detection
    const attacked = pos.isAttacked(sq, side ^ 1);
    if (!attacked) continue;
    const defended = pos.isAttacked(sq, side);
    loose.push({
      square: "abcdefgh"[sq & 7] + ((sq >> 4) + 1),
      piece: PIECE_LETTER[type],
      value: SIMPLE_VALUE[type],
      defended,
    });
  }
  return loose.sort((a, b) => b.value - a.value);
}

function scoreLabel(score) {
  if (Math.abs(score) > MATE_SCORE - 1000) {
    const plies = MATE_SCORE - Math.abs(score);
    const moves = Math.ceil(plies / 2);
    return score > 0 ? `mate in ${moves}` : `mated in ${moves}`;
  }
  const pawns = score / 100;
  if (Math.abs(pawns) < 0.3) return "level";
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

// Turns an engine line into something a model can reason about in words.
function annotateCandidate(chess, uci, score, bestScore) {
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4);
  let san = uci;
  const verbose = chess.moves({ verbose: true })
    .find((m) => m.from === from && m.to === to && (!promo || m.promotion === promo));
  if (verbose) san = verbose.san;

  const tags = [];
  if (verbose?.captured) tags.push(`captures ${PIECE_LETTER[{ p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 }[verbose.captured]]}`);
  if (verbose?.san.includes("#")) tags.push("checkmate");
  else if (verbose?.san.includes("+")) tags.push("check");
  if (verbose?.promotion) tags.push("promotes");
  if (verbose?.flags?.includes("k") || verbose?.flags?.includes("q")) tags.push("castles");

  const loss = bestScore - score;
  if (loss <= 10) tags.push("engine's top choice");
  else if (loss <= 40) tags.push("nearly as good");
  else if (loss >= 150) tags.push("clearly worse");

  return { san, uci, score, label: scoreLabel(score), tags };
}

// ─── prompt ─────────────────────────────────────────────────────────────────
function buildPrompt({ identity, colorName, chess, pos, candidates, legalSans, opening }) {
  const persona = identity.persona;
  const material = materialSummary(pos);
  const ourLoose = findLoosePieces(pos, pos.side);
  const theirLoose = findLoosePieces(pos, pos.side ^ 1);
  const history = chess.history();
  const recent = history.slice(-8).join(" ") || "none yet — the game is starting";

  const threatLines = [];
  if (chess.inCheck()) threatLines.push("YOU ARE IN CHECK — you must deal with it this move.");
  if (theirLoose.length) {
    threatLines.push(`Opponent pieces you are attacking: ${theirLoose.slice(0, 4)
      .map((p) => `${p.piece}${p.square}${p.defended ? " (defended)" : " (HANGING)"}`).join(", ")}`);
  }
  if (ourLoose.length) {
    threatLines.push(`Your pieces under attack: ${ourLoose.slice(0, 4)
      .map((p) => `${p.piece}${p.square}${p.defended ? " (defended)" : " (HANGING — deal with this)"}`).join(", ")}`);
  }

  const candidateBlock = candidates
    .map((c, i) => `  ${i + 1}. ${c.san}  [eval ${c.label}]${c.tags.length ? "  — " + c.tags.join(", ") : ""}`)
    .join("\n");

  return `You are ${persona.label}, playing ${colorName} in a serious game on VetroAI's Chess Arena. You play to win.

# YOUR CHESS IDENTITY
School: ${persona.school}
Today you are ${identity.mood.label}. ${identity.mood.note}
Principles you play by:
${persona.doctrine.map((d) => `  - ${d}`).join("\n")}
Table-talk voice: ${persona.voice}

# POSITION
${renderBoard(pos)}

(uppercase = White, lowercase = Black, . = empty)
FEN: ${chess.fen()}
${opening ? `Opening: ${opening}\n` : ""}Move ${Math.floor(history.length / 2) + 1}, you are ${colorName} to play.
Recent moves: ${recent}
Material — ${material.text}  (${material.label})

# TACTICAL BRIEF
${threatLines.length ? threatLines.map((t) => `- ${t}`).join("\n") : "- No pieces are hanging for either side."}

# CANDIDATE MOVES (analysed to depth ${identity.depth ?? "?"}, eval from your side; positive is good for you)
${candidateBlock}

Any other legal move is allowed: ${legalSans.slice(0, 40).join(", ")}${legalSans.length > 40 ? ", …" : ""}

# HOW TO DECIDE
1. If you are in check or something is hanging, resolve that first.
2. Look at forcing moves — checks, captures, threats — before quiet ones.
3. Among moves of similar evaluation, pick the one that fits YOUR school and today's mood. That is what makes you *you*.
4. Do not play a move evaluated much worse than the top candidate unless you can name the concrete idea that justifies it.

Think briefly, then finish with exactly these two lines:
MOVE: <the move in algebraic notation, exactly as written above>
WHY: <one punchy sentence in your own voice, max 18 words>`;
}

// ─── move selection ─────────────────────────────────────────────────────────
// Among near-equal candidates, a persona with lower discipline is more willing
// to take the one that suits its taste. This is what stops eight models from
// playing identical engine moves.
function chooseEngineMove(identity, candidates, bestScore) {
  if (!candidates.length) return null;
  // Deliberately narrow. The real variety between personas comes from their
  // style weights changing which move the search *thinks* is best; this window
  // only breaks ties between moves that are genuinely close, so character
  // never costs more than a fraction of a pawn.
  const window = Math.min(30, (1 - identity.discipline) * identity.tolerance);
  const viable = candidates.filter((c) => bestScore - c.score <= Math.max(8, window));
  if (viable.length <= 1) return candidates[0];
  const weights = viable.map((c) => Math.exp(-(bestScore - c.score) / 10));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = identity.rng() * total;
  for (let i = 0; i < viable.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return viable[i];
  }
  return viable[0];
}

// Requests a move from an AI model for the given chess.js instance.
// Never throws for game-flow reasons — always resolves to a legal move.
export async function requestAIMove({ providerId, chess, color, signal, gameSeed = "default" }) {
  const legalSans = chess.moves();
  if (!legalSans.length) return null;

  const identity = buildGameIdentity(providerId, gameSeed, color);
  const colorName = color === "w" ? "White" : "Black";
  const fen = chess.fen();
  const pos = Position.fromFen(fen);

  // ── 1. Opening book, while it lasts ───────────────────────────────────────
  const history = chess.history();
  // Only when the recorded history actually covers the whole game. A position
  // set up from a FEN has an empty history at move 30, and without this check
  // the book would answer it with a first move.
  const plyFromFen = (chess.moveNumber() - 1) * 2 + (chess.turn() === "b" ? 1 : 0);
  const historyIsComplete = history.length === plyFromFen;
  if (historyIsComplete && history.length < 8) {
    const book = bookMove(history, legalSans, identity.rng, identity.mood.id);
    if (book) {
      return {
        move: book.san,
        commentary: `${book.name} — ${identity.mood.label}, so this is my kind of position.`,
        providerId,
        raw: "",
        source: "book",
        opening: book.name,
      };
    }
  }

  // ── 2. Engine analysis with this model's eyes ─────────────────────────────
  const analysis = arenaEngine.analyse(pos, {
    timeMs: identity.thinkMs,
    style: identity.style,
    multiPv: 5,
  });
  identity.depth = analysis.depth;

  const engineLines = analysis.lines.map((l) => ({ uci: pos.moveToUci(l.move), score: l.score }));
  const bestScore = engineLines.length ? engineLines[0].score : 0;
  const candidates = engineLines.map((l) => annotateCandidate(chess, l.uci, l.score, bestScore));
  const engineChoice = chooseEngineMove(identity, candidates, bestScore);

  // Only one legal reply — no point spending a model call on it.
  if (legalSans.length === 1) {
    return {
      move: legalSans[0],
      commentary: "Forced — there is nothing else.",
      providerId, raw: "", source: "forced",
    };
  }

  // ── 3. Ask the model to choose, with the analysis in hand ─────────────────
  const prompt = buildPrompt({
    identity, colorName, chess, pos, candidates, legalSans,
    opening: openingName(history),
  });

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 25000);
  const onExternalAbort = () => timeoutCtrl.abort();
  signal?.addEventListener("abort", onExternalAbort);

  let text = "";
  try {
    const opts = { temperature: 0.6, maxTokens: 420, signal: timeoutCtrl.signal };
    text = DEDICATED_CHESS_PROVIDERS.has(providerId)
      ? await fetchDedicatedChessText(providerId, prompt, opts)
      : await fetchAIText(providerId, prompt, opts);
  } catch (err) {
    if (signal?.aborted) throw err;
    text = "";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (signal?.aborted) {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const engineFallback = engineChoice || candidates[0];
  const parsed = parseMoveFromText(text, legalSans);

  // ── 4. Model unreadable → play the engine move, never a random one ────────
  if (!parsed) {
    return {
      move: engineFallback ? engineFallback.san : legalSans[0],
      commentary: extractCommentary(text) || "Trusting my own calculation here.",
      providerId, raw: text, source: "engine",
      eval: engineFallback ? engineFallback.label : null,
    };
  }

  // ── 5. Blunder veto ───────────────────────────────────────────────────────
  // Score the model's actual choice and compare it with the best line. A
  // persona with a wide tolerance is allowed its speculative sacrifices; none
  // of them is allowed to simply drop a piece.
  const chosen = candidates.find((c) => c.san === parsed);
  let chosenScore = chosen ? chosen.score : null;
  if (chosenScore === null) {
    const verbose = chess.moves({ verbose: true }).find((m) => m.san === parsed);
    if (verbose) {
      const uci = verbose.from + verbose.to + (verbose.promotion || "");
      const move = pos.findMoveByUci(uci);
      if (move && pos.makeMove(move)) {
        arenaEngine.nodes = 0;
        arenaEngine.aborted = false;
        arenaEngine.deadline = Date.now() + Math.max(120, identity.thinkMs / 3);
        chosenScore = -arenaEngine.search(pos, Math.max(2, analysis.depth - 1), -40000, 40000, identity.style, 1);
        pos.unmakeMove();
      }
    }
  }

  const veto = chosenScore !== null && bestScore - chosenScore > identity.tolerance + 60;
  if (veto && engineFallback) {
    return {
      move: engineFallback.san,
      commentary: extractCommentary(text) || "Recalculated — that line collapses a few moves deeper.",
      providerId, raw: text, source: "veto",
      eval: engineFallback.label,
      vetoed: parsed,
    };
  }

  return {
    move: parsed,
    commentary: extractCommentary(text) || "Committed to the move.",
    providerId, raw: text, source: "model",
    eval: chosenScore !== null ? scoreLabel(chosenScore) : null,
  };
}

// Re-exported so the arena screen can show what a model is playing like.
export { getPersona, analysePosition };
