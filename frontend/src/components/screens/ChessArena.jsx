import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from "react";
import { Chess } from "chess.js";
import {
  X, Play, Pause, SkipForward, RotateCcw, Swords, Eye, User, Trophy, Crown,
  ChevronLeft, Loader2, Shuffle, Flag, Sparkles, Box, Grid3x3, ArrowRight, Scale, Zap,
} from "lucide-react";
import { CHESS_MODELS, CHESS_DIFFICULTIES, ARENA_LEVEL, getModel, requestAIMove } from "../../utils/chessAI";
import { openingName } from "../../utils/chessPersonas";
import { repertoireName } from "../../utils/chessOpenings";
import Board2D from "./chess2d/Board2D";
import "./ChessArena.css";

// The 3D table is optional now, so three.js only loads if someone picks it.
const Board3D = lazy(() => import("./chess3d/Board3D"));

const VIEW_KEY = "vetroai_chess_view";
const DIFFICULTY_KEY = "vetroai_chess_difficulty";
const readPref = (key, fallback, allowed) => {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; }
};
const writePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

// Flat board by default; the 3D table stays one tap away.
function useBoardView() {
  const [view, setView] = useState(() => readPref(VIEW_KEY, "2d", ["2d", "3d"]));
  const toggle = useCallback(() => setView((v) => { const next = v === "2d" ? "3d" : "2d"; writePref(VIEW_KEY, next); return next; }), []);
  return [view, toggle];
}

function ViewToggle({ view, onToggle }) {
  return (
    <button className="ca-btn" onClick={onToggle} title={view === "2d" ? "Switch to the 3D table" : "Switch to the flat board"}>
      {view === "2d" ? <><Box size={15} /> 3D</> : <><Grid3x3 size={15} /> 2D</>}
    </button>
  );
}

function ArenaBoard({ view, ...props }) {
  if (view === "3d") {
    return (
      <Suspense fallback={<div className="ca-board2d ca-board-loading"><Loader2 size={22} className="ca-spin" /></div>}>
        <Board3D {...props} />
      </Suspense>
    );
  }
  return <Board2D {...props} />;
}

// ─── constants ──────────────────────────────────────────────────────────────
const PIECE_UNICODE = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
const PIECE_POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CAPTURE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4 };
const LEADERBOARD_KEY = "vetroai_chess_leaderboard_v1";
const MATE_SCORE = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLeaderboard() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function saveLeaderboard(board) {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board)); } catch { /* ignore */ }
}
function recordResult(board, whiteId, blackId, result) {
  const next = { ...board };
  const bump = (id, key) => {
    const prev = next[id] || { wins: 0, losses: 0, draws: 0, games: 0 };
    next[id] = { ...prev, [key]: prev[key] + 1, games: prev.games + 1 };
  };
  if (result === "draw") { bump(whiteId, "draws"); bump(blackId, "draws"); }
  else if (result === "w") { bump(whiteId, "wins"); bump(blackId, "losses"); }
  else if (result === "b") { bump(blackId, "wins"); bump(whiteId, "losses"); }
  return next;
}

function getGameStatus(chess) {
  if (chess.isCheckmate()) return { over: true, result: chess.turn() === "w" ? "b" : "w", reason: "checkmate", check: true };
  if (chess.isStalemate()) return { over: true, result: "draw", reason: "stalemate", check: false };
  if (chess.isThreefoldRepetition()) return { over: true, result: "draw", reason: "threefold repetition", check: false };
  if (chess.isInsufficientMaterial()) return { over: true, result: "draw", reason: "insufficient material", check: false };
  if (chess.isDraw()) return { over: true, result: "draw", reason: "the 50-move rule", check: false };
  return { over: false, result: null, reason: null, check: chess.isCheck() };
}

function randomPair() {
  const a = Math.floor(Math.random() * CHESS_MODELS.length);
  let b = Math.floor(Math.random() * (CHESS_MODELS.length - 1));
  if (b >= a) b += 1;
  return Math.random() < 0.5 ? [CHESS_MODELS[a].id, CHESS_MODELS[b].id] : [CHESS_MODELS[b].id, CHESS_MODELS[a].id];
}

// Material balance in pawns, from White's side.
function materialBalance(chess) {
  let total = 0;
  for (const row of chess.board()) {
    for (const cell of row) if (cell) total += (cell.color === "w" ? 1 : -1) * PIECE_POINTS[cell.type];
  }
  return total;
}

// ─── mutable game state hook ────────────────────────────────────────────────
const newGameSeed = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function useChessGame() {
  // A single long-lived Chess instance mutated in place; `version` is bumped
  // after every mutation so components know to re-render and re-derive state.
  const [chess] = useState(() => new Chess());
  const [version, setVersion] = useState(0);
  // Every game draws a fresh seed. Both models derive their mood and opening
  // choice from it, so the same pairing never replays the same game.
  const [gameSeed, setGameSeed] = useState(newGameSeed);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const reset = useCallback(() => { chess.reset(); setGameSeed(newGameSeed()); bump(); }, [chess, bump]);
  const makeMove = useCallback((move) => {
    let result = null;
    try { result = chess.move(move); } catch { result = null; }
    if (result) bump();
    return result;
  }, [chess, bump]);
  return { chess, version, makeMove, reset, bump, gameSeed };
}

// Everything the play screens derive from the current position.
function useGameView(chess, version) {
  return useMemo(() => {
    const verboseHistory = chess.history({ verbose: true });
    const historySAN = verboseHistory.map((m) => m.san);
    return {
      status: getGameStatus(chess),
      historySAN,
      verboseHistory,
      lastMove: verboseHistory.length ? verboseHistory[verboseHistory.length - 1] : null,
      balance: materialBalance(chess),
      opening: repertoireName(historySAN) || openingName(historySAN),
    };
    // `chess` is a stable, mutated-in-place instance — `version` is what
    // actually signals a new position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, version]);
}

// ─── shared AI-move engine hook (thinking state + one-shot move request) ───
function useAIMoveEngine() {
  const [thinking, setThinking] = useState(false);
  const [commentary, setCommentary] = useState(null);
  // Latest engine evaluation, in centipawns from White's side.
  const [whiteEval, setWhiteEval] = useState(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    // In StrictMode dev, effects mount → cleanup → mount again; re-arm on every
    // real mount so the earlier phantom cleanup doesn't leave this stuck false.
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current?.abort(); };
  }, []);

  const doOneMove = useCallback(async (chess, providerId, makeMove, minDelayMs = 600, gameSeed = "default", difficulty = null) => {
    if (chess.isGameOver()) return false;
    const moverColor = chess.turn();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (mountedRef.current) setThinking(true);
    try {
      const [res] = await Promise.all([
        requestAIMove({ providerId, chess, color: moverColor, signal: ctrl.signal, gameSeed, difficulty }),
        sleep(minDelayMs),
      ]);
      if (ctrl.signal.aborted || !mountedRef.current) return false;
      if (res) {
        const result = makeMove(res.move);
        if (result && mountedRef.current) {
          setCommentary({
            color: moverColor, providerId, text: res.commentary, move: result.san,
            source: res.source, eval: res.eval, vetoed: res.vetoed,
          });
          if (typeof res.score === "number") setWhiteEval(moverColor === "w" ? res.score : -res.score);
        }
        return Boolean(result);
      }
      return false;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setThinking(false);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => { setCommentary(null); setWhiteEval(null); }, []);
  return { thinking, commentary, whiteEval, clear, doOneMove, cancel, mountedRef };
}

// ─── small shared bits ──────────────────────────────────────────────────────
function Avatar({ modelId, you = false, size = 36 }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (you) {
    return <span className="ca-avatar ca-avatar-you" style={{ width: size, height: size }}><User size={size * 0.5} /></span>;
  }
  const model = getModel(modelId);
  if (model.logo && !logoFailed) {
    return (
      <span className="ca-avatar ca-avatar-logo" style={{ "--mc": model.color, width: size, height: size }}>
        <img src={model.logo} alt={model.name} style={{ width: size * 0.58, height: size * 0.58 }} onError={() => setLogoFailed(true)} />
      </span>
    );
  }
  return (
    <span className="ca-avatar" style={{ "--mc": model.color, width: size, height: size, fontSize: size * 0.4 }}>
      {model.avatar}
    </span>
  );
}

function CapturedPieces({ verboseHistory, side }) {
  // Pieces `side` has taken, biggest first.
  const taken = verboseHistory
    .filter((m) => m.color === side && m.captured)
    .map((m) => m.captured)
    .sort((a, b) => CAPTURE_ORDER[a] - CAPTURE_ORDER[b]);
  const opp = side === "w" ? "b" : "w";
  return (
    <span className="ca-taken" aria-label="captured pieces">
      {taken.map((type, i) => (
        <span key={i} className={`ca-taken-piece ca-taken-${opp}`}>{PIECE_UNICODE.b[type]}</span>
      ))}
    </span>
  );
}

// One row above or below the board: who is playing that side, what they've
// captured, the material edge, and whether they are thinking right now.
function PlayerStrip({ modelId, you = false, color, subtitle, active, thinking, verboseHistory, balance }) {
  const model = you ? null : getModel(modelId);
  const edge = color === "w" ? balance : -balance;
  return (
    <div className={`ca-strip ${active ? "ca-strip-active" : ""}`} style={{ "--mc": model ? model.color : "#94a3b8" }}>
      <Avatar modelId={modelId} you={you} />
      <div className="ca-strip-info">
        <div className="ca-strip-name">
          <span className={`ca-side-dot ca-side-${color}`} />
          {you ? "You" : model.name}
          {subtitle && <span className="ca-strip-sub">{subtitle}</span>}
        </div>
        <div className="ca-strip-taken">
          <CapturedPieces verboseHistory={verboseHistory} side={color} />
          {edge > 0 && <span className="ca-edge">+{edge}</span>}
        </div>
      </div>
      {active && (
        <span className={`ca-turn-pill ${thinking ? "ca-turn-thinking" : ""}`}>
          {thinking ? <><Loader2 size={12} className="ca-spin" /> Thinking</> : "To move"}
        </span>
      )}
    </div>
  );
}

// Vertical evaluation bar: the white share grows as White's position improves.
function EvalBar({ whiteEval, orientation = "w" }) {
  const hasEval = typeof whiteEval === "number";
  const cp = hasEval ? whiteEval : 0;
  const isMate = Math.abs(cp) > MATE_SCORE - 1000;
  const whiteShare = isMate ? (cp > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-cp / 350)) - 1);
  const label = !hasEval ? "0.0"
    : isMate ? `M${Math.ceil((MATE_SCORE - Math.abs(cp)) / 2)}`
      : `${Math.abs(cp / 100).toFixed(1)}`;
  const whiteAhead = cp >= 0;
  return (
    <div className={`ca-evalbar ${orientation === "b" ? "ca-evalbar-flip" : ""}`} title="Engine evaluation">
      <div className="ca-evalbar-white" style={{ height: `${Math.min(100, Math.max(0, whiteShare))}%` }} />
      <span className={`ca-evalbar-label ${whiteAhead ? "ca-evalbar-label-w" : "ca-evalbar-label-b"}`}>{label}</span>
    </div>
  );
}

function StatusLine({ status, turnName, thinking, opening }) {
  let text;
  if (status.over) text = status.result === "draw" ? `Draw · ${status.reason}` : `${status.reason === "checkmate" ? "Checkmate" : "Game over"}`;
  else if (turnName === "You") text = status.check ? "You are in check" : "Your move";
  else if (status.check) text = `${turnName} is in check`;
  else text = thinking ? `${turnName} is thinking…` : `${turnName} to move`;
  return (
    <div className="ca-status">
      <span className={`ca-status-dot ${status.over ? "ca-status-over" : thinking ? "ca-status-live" : ""}`} />
      <span className="ca-status-text">{text}</span>
      {opening && <span className="ca-opening">{opening}</span>}
    </div>
  );
}

function CommentaryCard({ commentary }) {
  if (!commentary) {
    return <div className="ca-comment ca-comment-empty">Moves and notes will appear here.</div>;
  }
  const model = getModel(commentary.providerId);
  return (
    <div className="ca-comment" style={{ "--mc": model.color }}>
      <Avatar modelId={commentary.providerId} size={28} />
      <div className="ca-comment-body">
        <div className="ca-comment-head">
          <strong>{model.name}</strong>
          <span className="ca-comment-move">{commentary.move}</span>
          {commentary.eval && <span className="ca-comment-eval">{commentary.eval === "level" ? "=" : commentary.eval}</span>}
        </div>
        <p>{commentary.text}</p>
      </div>
    </div>
  );
}

function MoveList({ history }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [history.length]);
  const pairs = [];
  for (let i = 0; i < history.length; i += 2) pairs.push([history[i], history[i + 1]]);
  const last = history.length - 1;
  return (
    <div className="ca-moves">
      <div className="ca-section-title">Moves</div>
      <div className="ca-moves-grid">
        {pairs.length === 0 && <p className="ca-moves-empty">No moves yet.</p>}
        {pairs.map((pair, i) => (
          <React.Fragment key={i}>
            <span className="ca-move-num">{i + 1}.</span>
            <span className={`ca-move ${i * 2 === last ? "ca-move-last" : ""}`}>{pair[0]}</span>
            <span className={`ca-move ${i * 2 + 1 === last ? "ca-move-last" : ""}`}>{pair[1] || ""}</span>
          </React.Fragment>
        ))}
        <span ref={endRef} />
      </div>
    </div>
  );
}

function ResultBanner({ status, whiteId, blackId, playerColor, onRematch }) {
  if (!status.over) return null;
  let headline;
  if (status.result === "draw") {
    headline = "Draw";
  } else {
    const winnerId = status.result === "w" ? whiteId : blackId;
    headline = playerColor
      ? (status.result === playerColor ? "You win!" : `${getModel(winnerId).name} wins`)
      : `${getModel(winnerId).name} wins`;
  }
  return (
    <div className="ca-result">
      <Crown size={20} />
      <div className="ca-result-text">
        <strong>{headline}</strong>
        <span>by {status.reason}</span>
      </div>
      {onRematch && <button className="ca-btn ca-btn-accent" onClick={onRematch}><RotateCcw size={15} /> Rematch</button>}
    </div>
  );
}

// The shared play layout: board (with eval bar and player strips) on the
// left, a side panel with status, notes, moves and controls on the right.
function PlayLayout({ top, bottom, board, evalBar, panelTop, controls, extra, children }) {
  return (
    <div className="ca-play">
      <div className="ca-board-wrap">
        {top}
        <div className="ca-board-frame">
          {evalBar}
          <div className="ca-board-slot">{board}</div>
        </div>
        {bottom}
      </div>
      <aside className="ca-panel">
        {panelTop}
        <div className="ca-controls">{controls}</div>
        {children}
        {extra}
      </aside>
    </div>
  );
}

function ModelPicker({ label, value, onChange, disabledId, sideColor }) {
  return (
    <div className="ca-picker">
      <div className="ca-picker-label">
        {sideColor && <span className={`ca-side-dot ca-side-${sideColor}`} />}
        {label}
      </div>
      <div className="ca-picker-grid">
        {CHESS_MODELS.map((m) => (
          <button
            key={m.id}
            className={`ca-chip ${value === m.id ? "active" : ""}`}
            style={{ "--mc": m.color }}
            disabled={disabledId === m.id}
            onClick={() => onChange(m.id)}
          >
            <Avatar modelId={m.id} size={26} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AI vs AI mode ──────────────────────────────────────────────────────────
function AIvAI() {
  const { chess, version, makeMove, reset, gameSeed } = useChessGame();
  const { thinking, commentary, whiteEval, clear, doOneMove, cancel } = useAIMoveEngine();
  const [whiteModel, setWhiteModel] = useState(CHESS_MODELS[0].id);
  const [blackModel, setBlackModel] = useState(CHESS_MODELS[3].id);
  const [boardView, toggleBoardView] = useBoardView();
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(700);
  const speedRef = useRef(speedMs);
  useEffect(() => { speedRef.current = speedMs; }, [speedMs]);

  const { status, historySAN, verboseHistory, lastMove, balance, opening } = useGameView(chess, version);

  useEffect(() => {
    if (!playing) return;
    let stop = false;
    (async () => {
      while (!stop) {
        if (chess.isGameOver()) { setPlaying(false); break; }
        const providerId = chess.turn() === "w" ? whiteModel : blackModel;
        // Both sides play at the same arena strength, whichever model it is.
        await doOneMove(chess, providerId, makeMove, speedRef.current, gameSeed, ARENA_LEVEL);
        if (stop) break;
        if (chess.isGameOver()) { setPlaying(false); break; }
      }
    })();
    return () => { stop = true; cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const startGame = () => { setStarted(true); setPlaying(true); };
  const stepOnce = () => {
    if (thinking || playing || chess.isGameOver()) return;
    const providerId = chess.turn() === "w" ? whiteModel : blackModel;
    doOneMove(chess, providerId, makeMove, 0, gameSeed, ARENA_LEVEL);
  };
  const resetAll = () => { setPlaying(false); cancel(); reset(); clear(); setStarted(false); };
  const rematch = () => { setPlaying(false); cancel(); reset(); clear(); setPlaying(true); };

  if (!started) {
    return (
      <div className="ca-setup">
        <div className="ca-setup-head">
          <h2>AI vs AI</h2>
          <p>Pick two models and watch them play it out.</p>
        </div>
        <div className="ca-setup-duel">
          <ModelPicker label="White" sideColor="w" value={whiteModel} onChange={setWhiteModel} />
          <div className="ca-duel-vs">VS</div>
          <ModelPicker label="Black" sideColor="b" value={blackModel} onChange={setBlackModel} />
        </div>
        <div className="ca-note"><Scale size={15} /> Both sides play at maximum strength — more thinking time than the Master level, grandmaster opening theory — with identical settings, so the better play on the board wins.</div>
        <div className="ca-setup-actions">
          <button className="ca-btn-primary" disabled={whiteModel === blackModel} onClick={startGame}>
            <Swords size={16} /> Start match
          </button>
          {whiteModel === blackModel && <p className="ca-setup-hint">Pick two different models for a real contest.</p>}
        </div>
      </div>
    );
  }

  const turnName = getModel(chess.turn() === "w" ? whiteModel : blackModel).name;
  return (
    <PlayLayout
      evalBar={<EvalBar whiteEval={whiteEval} />}
      top={<PlayerStrip modelId={blackModel} color="b" subtitle="Black" active={chess.turn() === "b" && !status.over} thinking={thinking} verboseHistory={verboseHistory} balance={balance} />}
      bottom={<PlayerStrip modelId={whiteModel} color="w" subtitle="White" active={chess.turn() === "w" && !status.over} thinking={thinking} verboseHistory={verboseHistory} balance={balance} />}
      board={<ArenaBoard view={boardView} chess={chess} orientation="w" lastMove={lastMove} inCheck={status.check} />}
      panelTop={<>
        <div className="ca-strength"><Zap size={13} /> Maximum strength · both sides equal</div>
        <StatusLine status={status} turnName={turnName} thinking={thinking} opening={opening} />
        <ResultBanner status={status} whiteId={whiteModel} blackId={blackModel} onRematch={rematch} />
        <CommentaryCard commentary={commentary} />
      </>}
      controls={<>
        {!status.over && (
          <button className="ca-btn ca-btn-accent" onClick={() => setPlaying((p) => !p)}>
            {playing ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Play</>}
          </button>
        )}
        {!status.over && <button className="ca-btn" onClick={stepOnce} disabled={playing || thinking} title="Play one move"><SkipForward size={15} /></button>}
        <div className="ca-segment" role="group" aria-label="Pace">
          {[[0, "Fast"], [700, "Normal"], [1600, "Slow"]].map(([ms, name]) => (
            <button key={ms} className={speedMs === ms ? "active" : ""} onClick={() => setSpeedMs(ms)}>{name}</button>
          ))}
        </div>
        <ViewToggle view={boardView} onToggle={toggleBoardView} />
        <button className="ca-btn" onClick={resetAll} title="New setup"><RotateCcw size={15} /></button>
      </>}
    >
      <MoveList history={historySAN} />
    </PlayLayout>
  );
}

// ─── Spectator mode ─────────────────────────────────────────────────────────
function Spectator() {
  const { chess, version, makeMove, reset, gameSeed } = useChessGame();
  const { thinking, commentary, whiteEval, clear, doOneMove, cancel } = useAIMoveEngine();
  const [[whiteModel, blackModel], setPair] = useState(randomPair);
  const [boardView, toggleBoardView] = useBoardView();
  const [playing, setPlaying] = useState(true);
  const [matchNum, setMatchNum] = useState(1);
  const [leaderboard, setLeaderboard] = useState(loadLeaderboard);
  const [pendingNext, setPendingNext] = useState(false);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const { status, historySAN, verboseHistory, lastMove, balance, opening } = useGameView(chess, version);

  useEffect(() => {
    if (!playing || pendingNext) return;
    let stop = false;
    (async () => {
      while (!stop) {
        if (chess.isGameOver()) break;
        const providerId = chess.turn() === "w" ? whiteModel : blackModel;
        await doOneMove(chess, providerId, makeMove, 600, gameSeed, ARENA_LEVEL);
        if (stop) break;
        if (chess.isGameOver()) break;
      }
    })();
    return () => { stop = true; cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, whiteModel, blackModel, pendingNext]);

  // handle game-over: record result, then queue up the next random matchup.
  useEffect(() => {
    if (!status.over || pendingNext) return;
    setPendingNext(true);
    setLeaderboard((prev) => {
      const next = recordResult(prev, whiteModel, blackModel, status.result);
      saveLeaderboard(next);
      return next;
    });
    const t = setTimeout(() => {
      if (!playingRef.current) { setPendingNext(false); return; }
      reset();
      clear();
      setPair(randomPair());
      setMatchNum((n) => n + 1);
      setPendingNext(false);
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.over]);

  const skipToNext = () => {
    cancel();
    reset();
    clear();
    setPair(randomPair());
    setMatchNum((n) => n + 1);
    setPendingNext(false);
  };

  const ranked = useMemo(() => {
    return CHESS_MODELS
      .map((m) => ({ ...m, ...(leaderboard[m.id] || { wins: 0, losses: 0, draws: 0, games: 0 }) }))
      .sort((a, b) => (b.wins + b.draws / 2) - (a.wins + a.draws / 2) || b.games - a.games);
  }, [leaderboard]);

  const turnName = getModel(chess.turn() === "w" ? whiteModel : blackModel).name;
  return (
    <PlayLayout
      evalBar={<EvalBar whiteEval={whiteEval} />}
      top={<PlayerStrip modelId={blackModel} color="b" subtitle="Black" active={chess.turn() === "b" && !status.over} thinking={thinking} verboseHistory={verboseHistory} balance={balance} />}
      bottom={<PlayerStrip modelId={whiteModel} color="w" subtitle="White" active={chess.turn() === "w" && !status.over} thinking={thinking} verboseHistory={verboseHistory} balance={balance} />}
      board={<ArenaBoard view={boardView} chess={chess} orientation="w" lastMove={lastMove} inCheck={status.check} />}
      panelTop={<>
        <div className="ca-match-no">Match #{matchNum}</div>
        <div className="ca-strength"><Zap size={13} /> Maximum strength · both sides equal</div>
        <StatusLine status={status} turnName={turnName} thinking={thinking} opening={opening} />
        <ResultBanner status={status} whiteId={whiteModel} blackId={blackModel} />
        <CommentaryCard commentary={commentary} />
      </>}
      controls={<>
        <button className="ca-btn ca-btn-accent" onClick={() => setPlaying((p) => !p)}>
          {playing ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}
        </button>
        <button className="ca-btn" onClick={skipToNext} title="Skip to next matchup"><Shuffle size={15} /> Next</button>
        <ViewToggle view={boardView} onToggle={toggleBoardView} />
      </>}
      extra={
        <div className="ca-leaderboard">
          <div className="ca-section-title"><Trophy size={13} /> Leaderboard</div>
          {ranked.map((m, i) => (
            <div className="ca-lb-row" key={m.id} style={{ "--mc": m.color }}>
              <span className="ca-lb-rank">{i + 1}</span>
              <Avatar modelId={m.id} size={24} />
              <span className="ca-lb-name">{m.name}</span>
              <span className="ca-lb-stats"><b>{m.wins}</b>W · {m.losses}L · {m.draws}D</span>
            </div>
          ))}
        </div>
      }
    >
      <MoveList history={historySAN} />
    </PlayLayout>
  );
}

// ─── Player vs AI mode ──────────────────────────────────────────────────────
function PlayerVsAI() {
  const { chess, version, makeMove, reset, gameSeed } = useChessGame();
  const { thinking, commentary, clear, doOneMove, cancel } = useAIMoveEngine();
  const [aiModel, setAiModel] = useState(CHESS_MODELS[0].id);
  const [difficulty, setDifficultyState] = useState(() => readPref(DIFFICULTY_KEY, "hard", CHESS_DIFFICULTIES.map((d) => d.id)));
  const setDifficulty = (id) => { setDifficultyState(id); writePref(DIFFICULTY_KEY, id); };
  const [boardView, toggleBoardView] = useBoardView();
  const [sideChoice, setSideChoice] = useState("w");
  const [playerColor, setPlayerColor] = useState("w");
  const [started, setStarted] = useState(false);
  const [selected, setSelected] = useState(null);
  const [resigned, setResigned] = useState(false);

  const aiColor = playerColor === "w" ? "b" : "w";
  const view = useGameView(chess, version);
  const { historySAN, verboseHistory, lastMove, balance, opening } = view;
  const status = resigned ? { over: true, result: aiColor, reason: "resignation", check: false } : view.status;
  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return chess.moves({ square: selected, verbose: true }).map((m) => m.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, selected, version]);

  useEffect(() => {
    if (!started || resigned) return;
    if (chess.isGameOver()) return;
    if (chess.turn() !== aiColor) return;
    doOneMove(chess, aiModel, makeMove, 350, gameSeed, difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, version, aiColor, aiModel, resigned, difficulty]);

  const handleSquareClick = (square) => {
    if (thinking || status.over) return;
    if (chess.turn() !== playerColor) return;
    const piece = chess.get(square);
    if (selected) {
      if (legalTargets.includes(square)) {
        const verboseMoves = chess.moves({ square: selected, verbose: true });
        const chosen = verboseMoves.find((m) => m.to === square);
        const moveObj = { from: selected, to: square };
        if (chosen?.promotion) moveObj.promotion = "q";
        makeMove(moveObj);
        setSelected(null);
        return;
      }
      if (piece && piece.color === playerColor) { setSelected(square); return; }
      setSelected(null);
      return;
    }
    if (piece && piece.color === playerColor) setSelected(square);
  };

  // Drag-and-drop on the flat board. Returns whether the move was played.
  const handlePieceDrop = (from, to) => {
    if (thinking || status.over || chess.turn() !== playerColor) return false;
    const move = chess.moves({ square: from, verbose: true }).find((m) => m.to === to);
    if (!move) return false;
    const moveObj = { from, to };
    if (move.promotion) moveObj.promotion = "q";
    const played = makeMove(moveObj);
    setSelected(null);
    return Boolean(played);
  };

  const startGame = () => {
    setPlayerColor(sideChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : sideChoice);
    setStarted(true);
    setResigned(false);
  };
  const resetAll = () => { cancel(); reset(); clear(); setStarted(false); setSelected(null); setResigned(false); };
  const rematch = () => { cancel(); reset(); clear(); setSelected(null); setResigned(false); setStarted(true); };

  if (!started) {
    return (
      <div className="ca-setup">
        <div className="ca-setup-head">
          <h2>Player vs AI</h2>
          <p>Choose an opponent, a side and how hard it should play.</p>
        </div>
        <ModelPicker label="Opponent" value={aiModel} onChange={setAiModel} />
        <div className="ca-setup-row">
          <div className="ca-picker">
            <div className="ca-picker-label">Your side</div>
            <div className="ca-segment ca-segment-lg">
              {[["w", "White"], ["b", "Black"], ["random", "Random"]].map(([id, name]) => (
                <button key={id} className={sideChoice === id ? "active" : ""} onClick={() => setSideChoice(id)}>
                  {id === "random" ? <Shuffle size={14} /> : <span className={`ca-side-dot ca-side-${id}`} />} {name}
                </button>
              ))}
            </div>
          </div>
          <div className="ca-picker">
            <div className="ca-picker-label">Difficulty</div>
            <div className="ca-level-grid">
              {CHESS_DIFFICULTIES.map((d, i) => (
                <button key={d.id} className={`ca-level ${difficulty === d.id ? "active" : ""}`} onClick={() => setDifficulty(d.id)}>
                  <span className="ca-level-bars">{[0, 1, 2, 3].map((b) => <i key={b} className={b <= i ? "on" : ""} />)}</span>
                  <span className="ca-level-name">{d.name}</span>
                  <small>{d.desc}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ca-setup-actions">
          <button className="ca-btn-primary" onClick={startGame}><Swords size={16} /> Start game</button>
        </div>
      </div>
    );
  }

  const level = CHESS_DIFFICULTIES.find((d) => d.id === difficulty)?.name;
  const aiName = getModel(aiModel).name;
  const turnName = chess.turn() === playerColor ? "You" : aiName;
  return (
    <PlayLayout
      top={<PlayerStrip modelId={aiModel} color={aiColor} subtitle={level} active={chess.turn() === aiColor && !status.over} thinking={thinking} verboseHistory={verboseHistory} balance={balance} />}
      bottom={<PlayerStrip you color={playerColor} active={chess.turn() === playerColor && !status.over} thinking={false} verboseHistory={verboseHistory} balance={balance} />}
      board={
        <ArenaBoard
          view={boardView}
          chess={chess}
          orientation={playerColor}
          lastMove={lastMove}
          selected={selected}
          legalTargets={legalTargets}
          onSquareClick={handleSquareClick}
          onMove={handlePieceDrop}
          draggableColor={playerColor}
          interactive={!status.over && !thinking && chess.turn() === playerColor}
          inCheck={status.check}
        />
      }
      panelTop={<>
        <StatusLine status={status} turnName={turnName} thinking={thinking} opening={opening} />
        <ResultBanner status={status} whiteId={playerColor === "w" ? "you" : aiModel} blackId={playerColor === "b" ? "you" : aiModel} playerColor={playerColor} onRematch={rematch} />
        <CommentaryCard commentary={commentary} />
      </>}
      controls={<>
        {!status.over && <button className="ca-btn" onClick={() => setResigned(true)}><Flag size={15} /> Resign</button>}
        <ViewToggle view={boardView} onToggle={toggleBoardView} />
        <button className="ca-btn" onClick={resetAll} title="New setup"><RotateCcw size={15} /></button>
      </>}
    >
      <MoveList history={historySAN} />
    </PlayLayout>
  );
}

// ─── mode picker menu ───────────────────────────────────────────────────────
function ModeMenu({ onPick }) {
  const cards = [
    { id: "player-vs-ai", title: "Play vs AI", icon: User, desc: "Take on any model yourself — from relaxed to full grandmaster strength.", tag: "4 levels" },
    { id: "ai-vs-ai", title: "AI vs AI", icon: Swords, desc: "Two models at maximum strength, evenly matched, playing real opening theory.", tag: "Max strength" },
    { id: "spectator", title: "Spectator", icon: Eye, desc: "Random matchups at maximum strength, back to back, with a running leaderboard.", tag: "Non-stop" },
  ];
  return (
    <div className="ca-menu">
      <div className="ca-menu-hero">
        <div className="ca-hero-glyphs" aria-hidden="true">♞ ♛ ♜</div>
        <h1>Chess Arena</h1>
        <p>Real chess against real AI models. Choose how you want to play.</p>
      </div>
      <div className="ca-menu-cards">
        {cards.map((c) => (
          <button key={c.id} className="ca-menu-card" onClick={() => onPick(c.id)}>
            <span className="ca-menu-icon"><c.icon size={22} /></span>
            <span className="ca-menu-tag">{c.tag}</span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            <span className="ca-menu-go">Start <ArrowRight size={14} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── root ───────────────────────────────────────────────────────────────────
const MODE_NAMES = { "ai-vs-ai": "AI vs AI", spectator: "Spectator", "player-vs-ai": "Play vs AI" };

export default function ChessArena({ onClose }) {
  const [mode, setMode] = useState("menu");
  return (
    <div className="chess-arena">
      <div className="ca-header">
        <div className="ca-header-left">
          {mode !== "menu" ? (
            <button className="ca-back-link" onClick={() => setMode("menu")} title="Back to modes"><ChevronLeft size={16} /></button>
          ) : (
            <span className="ca-logo"><Sparkles size={15} /></span>
          )}
          <span className="ca-title">Chess Arena</span>
          {mode !== "menu" && <span className="ca-crumb">{MODE_NAMES[mode]}</span>}
        </div>
        <button className="ca-close" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="ca-body">
        {mode === "menu" && <ModeMenu onPick={setMode} />}
        {mode === "ai-vs-ai" && <AIvAI />}
        {mode === "spectator" && <Spectator />}
        {mode === "player-vs-ai" && <PlayerVsAI />}
      </div>
    </div>
  );
}
