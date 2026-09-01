import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Chess } from "chess.js";
import {
  X, Play, Pause, SkipForward, RotateCcw, Swords, Eye, User, Trophy, Crown,
  ChevronLeft, Loader2, Shuffle, Flag, Bot, Sparkles,
} from "lucide-react";
import { CHESS_MODELS, getModel, requestAIMove } from "../../utils/chessAI";
import "./ChessArena.css";

// ─── constants ──────────────────────────────────────────────────────────────
const PIECE_UNICODE = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const LEADERBOARD_KEY = "vetroai_chess_leaderboard_v1";
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

// ─── mutable game state hook ────────────────────────────────────────────────
function useChessGame() {
  // A single long-lived Chess instance mutated in place; `version` is bumped
  // after every mutation so components know to re-render and re-derive state.
  const [chess] = useState(() => new Chess());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const reset = useCallback(() => { chess.reset(); bump(); }, [chess, bump]);
  const makeMove = useCallback((move) => {
    let result = null;
    try { result = chess.move(move); } catch { result = null; }
    if (result) bump();
    return result;
  }, [chess, bump]);
  return { chess, version, makeMove, reset, bump };
}

// ─── shared AI-move engine hook (thinking state + one-shot move request) ───
function useAIMoveEngine() {
  const [thinking, setThinking] = useState(false);
  const [commentary, setCommentary] = useState(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    // In StrictMode dev, effects mount → cleanup → mount again; re-arm on every
    // real mount so the earlier phantom cleanup doesn't leave this stuck false.
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current?.abort(); };
  }, []);

  const doOneMove = useCallback(async (chess, providerId, makeMove, minDelayMs = 900) => {
    if (chess.isGameOver()) return false;
    const moverColor = chess.turn();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (mountedRef.current) setThinking(true);
    try {
      const [res] = await Promise.all([
        requestAIMove({ providerId, chess, color: moverColor, signal: ctrl.signal }),
        sleep(minDelayMs),
      ]);
      if (ctrl.signal.aborted || !mountedRef.current) return false;
      if (res) {
        const result = makeMove(res.move);
        if (result && mountedRef.current) {
          setCommentary({ color: moverColor, providerId, text: res.commentary, move: res.move });
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
  return { thinking, commentary, setCommentary, doOneMove, cancel, mountedRef };
}

// ─── board ───────────────────────────────────────────────────────────────
function ChessBoard({ chess, orientation = "w", lastMove, selected, legalTargets, onSquareClick, interactive, inCheck }) {
  const boardRows = chess.board();
  const rows = orientation === "w" ? boardRows : [...boardRows].reverse().map((r) => [...r].reverse());
  const rankLabels = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = orientation === "w" ? FILES : [...FILES].reverse();
  const kingSquare = inCheck
    ? boardRows.flat().find((cell) => cell && cell.type === "k" && cell.color === chess.turn())?.square ?? null
    : null;

  return (
    <div className="ca-board">
      {rows.map((row, ri) => (
        <div className="ca-board-row" key={ri}>
          {row.map((cell, fi) => {
            const file = fileLabels[fi];
            const rank = rankLabels[ri];
            const square = `${file}${rank}`;
            const fileIndex = FILES.indexOf(file);
            const dark = (fileIndex + rank) % 2 === 1;
            const isSelected = selected === square;
            const isLegal = legalTargets?.includes(square);
            const isLastMove = lastMove && (lastMove.from === square || lastMove.to === square);
            const isCheck = kingSquare === square;
            return (
              <div
                key={square}
                className={[
                  "ca-sq",
                  dark ? "ca-sq-dark" : "ca-sq-light",
                  isSelected ? "ca-sq-selected" : "",
                  isLastMove ? "ca-sq-lastmove" : "",
                  isCheck ? "ca-sq-check" : "",
                  interactive ? "ca-sq-interactive" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => interactive && onSquareClick?.(square)}
              >
                {fi === 0 && <span className="ca-coord ca-coord-rank">{rank}</span>}
                {ri === 7 && <span className="ca-coord ca-coord-file">{file}</span>}
                {cell && <span className={`ca-piece ca-piece-${cell.color}`}>{PIECE_UNICODE[cell.color][cell.type]}</span>}
                {isLegal && !cell && <span className="ca-dot" />}
                {isLegal && cell && <span className="ca-ring" />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── small shared bits ──────────────────────────────────────────────────────
function ModelBadge({ modelId, size = "md", turnActive, thinking }) {
  const model = getModel(modelId);
  return (
    <div className={`ca-model-badge ca-mb-${size} ${turnActive ? "ca-mb-active" : ""}`} style={{ "--mc": model.color }}>
      <span className="ca-mb-avatar">{model.avatar}</span>
      <span className="ca-mb-info">
        <span className="ca-mb-name">{model.name}</span>
        <span className="ca-mb-tagline">{model.tagline}</span>
      </span>
      {turnActive && thinking && <Loader2 size={14} className="ca-spin" />}
    </div>
  );
}

function CommentaryBubble({ commentary }) {
  if (!commentary) return null;
  const model = getModel(commentary.providerId);
  return (
    <div className="ca-commentary" style={{ "--mc": model.color }}>
      <span className="ca-commentary-avatar">{model.avatar}</span>
      <div>
        <strong>{model.name}</strong> played <code>{commentary.move}</code>
        <p>{commentary.text}</p>
      </div>
    </div>
  );
}

function MoveList({ history }) {
  const pairs = [];
  for (let i = 0; i < history.length; i += 2) pairs.push([history[i], history[i + 1]]);
  return (
    <div className="ca-movelist">
      {pairs.length === 0 && <p className="ca-movelist-empty">No moves yet.</p>}
      {pairs.map((pair, i) => (
        <div className="ca-move-row" key={i}>
          <span className="ca-move-num">{i + 1}.</span>
          <span className="ca-move-san">{pair[0]}</span>
          <span className="ca-move-san">{pair[1] || ""}</span>
        </div>
      ))}
    </div>
  );
}

function CapturedRow({ verboseHistory, side }) {
  const captured = verboseHistory
    .filter((m) => m.color === side && m.captured)
    .map((m) => m.captured);
  if (!captured.length) return null;
  const opp = side === "w" ? "b" : "w";
  return (
    <div className="ca-captured">
      {captured.map((type, i) => (
        <span key={i} className={`ca-captured-piece ca-piece-${opp}`}>{PIECE_UNICODE[opp][type]}</span>
      ))}
    </div>
  );
}

function ResultBanner({ status, whiteId, blackId, playerColor }) {
  if (!status.over) return null;
  let headline;
  if (status.result === "draw") {
    headline = `Draw — ${status.reason}`;
  } else {
    const winnerId = status.result === "w" ? whiteId : blackId;
    const winnerLabel = playerColor
      ? (status.result === playerColor ? "You win!" : `${getModel(winnerId).name} wins`)
      : `${getModel(winnerId).name} wins`;
    headline = `${status.reason === "checkmate" ? "Checkmate" : "Game over"} — ${winnerLabel}`;
  }
  return (
    <div className="ca-result-banner">
      <Crown size={18} />
      <span>{headline}</span>
    </div>
  );
}

// ─── AI vs AI mode ──────────────────────────────────────────────────────────
function AIvAI({ onExit }) {
  const { chess, version, makeMove, reset } = useChessGame();
  const { thinking, commentary, setCommentary, doOneMove, cancel } = useAIMoveEngine();
  const [whiteModel, setWhiteModel] = useState(CHESS_MODELS[0].id);
  const [blackModel, setBlackModel] = useState(CHESS_MODELS[3].id);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1200);

  // `chess` is a stable, mutated-in-place instance — `version` is what actually
  // signals a new position, so it must stay in every dependency array below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const status = useMemo(() => getGameStatus(chess), [chess, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historySAN = useMemo(() => chess.history(), [chess, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const verboseHistory = useMemo(() => chess.history({ verbose: true }), [chess, version]);
  const lastMove = verboseHistory.length ? verboseHistory[verboseHistory.length - 1] : null;

  useEffect(() => {
    if (!playing) return;
    let stop = false;
    (async () => {
      while (!stop) {
        if (chess.isGameOver()) { setPlaying(false); break; }
        const moverColor = chess.turn();
        const providerId = moverColor === "w" ? whiteModel : blackModel;
        await doOneMove(chess, providerId, makeMove, speedMs);
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
    doOneMove(chess, providerId, makeMove, 250);
  };
  const resetAll = () => { setPlaying(false); cancel(); reset(); setCommentary(null); setStarted(false); };
  const rematch = () => { setPlaying(false); cancel(); reset(); setCommentary(null); setPlaying(true); };

  if (!started) {
    return (
      <div className="ca-setup">
        <h3>AI vs AI</h3>
        <p className="ca-setup-sub">Pick two models and watch them battle it out, move by move.</p>
        <div className="ca-setup-pickers">
          <div className="ca-setup-col">
            <span className="ca-setup-label">White</span>
            {CHESS_MODELS.map((m) => (
              <button key={m.id} className={`ca-model-option ${whiteModel === m.id ? "active" : ""}`} style={{ "--mc": m.color }} onClick={() => setWhiteModel(m.id)}>
                <span className="ca-mb-avatar">{m.avatar}</span>{m.name}
              </button>
            ))}
          </div>
          <div className="ca-setup-col">
            <span className="ca-setup-label">Black</span>
            {CHESS_MODELS.map((m) => (
              <button key={m.id} className={`ca-model-option ${blackModel === m.id ? "active" : ""}`} style={{ "--mc": m.color }} onClick={() => setBlackModel(m.id)}>
                <span className="ca-mb-avatar">{m.avatar}</span>{m.name}
              </button>
            ))}
          </div>
        </div>
        <button className="ca-btn-primary" disabled={whiteModel === blackModel} onClick={startGame}>
          <Swords size={16} /> Start Match
        </button>
        {whiteModel === blackModel && <p className="ca-setup-hint">Pick two different models for a real contest.</p>}
      </div>
    );
  }

  return (
    <div className="ca-play">
      <div className="ca-play-header">
        <ModelBadge modelId={whiteModel} turnActive={chess.turn() === "w" && !status.over} thinking={thinking} />
        <span className="ca-vs">vs</span>
        <ModelBadge modelId={blackModel} turnActive={chess.turn() === "b" && !status.over} thinking={thinking} />
      </div>
      <div className="ca-play-body">
        <div className="ca-board-col">
          <CapturedRow verboseHistory={verboseHistory} side="b" />
          <ChessBoard chess={chess} orientation="w" lastMove={lastMove} inCheck={status.check} />
          <CapturedRow verboseHistory={verboseHistory} side="w" />
          <ResultBanner status={status} whiteId={whiteModel} blackId={blackModel} />
          <CommentaryBubble commentary={commentary} />
        </div>
        <div className="ca-side-col">
          <div className="ca-controls">
            {!status.over && (
              <button className="ca-btn-icon" onClick={() => setPlaying((p) => !p)} title={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
            )}
            {!status.over && <button className="ca-btn-icon" onClick={stepOnce} disabled={playing || thinking} title="Step one move"><SkipForward size={16} /></button>}
            <select className="ca-speed-select" value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} disabled={playing}>
              <option value={400}>Fast</option>
              <option value={1200}>Normal</option>
              <option value={2500}>Slow</option>
            </select>
            {status.over ? (
              <button className="ca-btn-icon" onClick={rematch} title="Rematch"><RotateCcw size={16} /> Rematch</button>
            ) : (
              <button className="ca-btn-icon" onClick={resetAll} title="Reset"><RotateCcw size={16} /></button>
            )}
            <button className="ca-btn-icon" onClick={onExit} title="Back to modes"><ChevronLeft size={16} /> Modes</button>
          </div>
          <MoveList history={historySAN} />
        </div>
      </div>
    </div>
  );
}

// ─── Spectator mode ─────────────────────────────────────────────────────────
function Spectator({ onExit }) {
  const { chess, version, makeMove, reset } = useChessGame();
  const { thinking, commentary, setCommentary, doOneMove, cancel } = useAIMoveEngine();
  const [[whiteModel, blackModel], setPair] = useState(randomPair);
  const [playing, setPlaying] = useState(true);
  const [matchNum, setMatchNum] = useState(1);
  const [leaderboard, setLeaderboard] = useState(loadLeaderboard);
  const [pendingNext, setPendingNext] = useState(false);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // `chess` is a stable, mutated-in-place instance — `version` is what actually
  // signals a new position, so it must stay in every dependency array below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const status = useMemo(() => getGameStatus(chess), [chess, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historySAN = useMemo(() => chess.history(), [chess, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const verboseHistory = useMemo(() => chess.history({ verbose: true }), [chess, version]);
  const lastMove = verboseHistory.length ? verboseHistory[verboseHistory.length - 1] : null;

  useEffect(() => {
    if (!playing || pendingNext) return;
    let stop = false;
    (async () => {
      while (!stop) {
        if (chess.isGameOver()) break;
        const moverColor = chess.turn();
        const providerId = moverColor === "w" ? whiteModel : blackModel;
        await doOneMove(chess, providerId, makeMove, 900);
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
      setCommentary(null);
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
    setCommentary(null);
    setPair(randomPair());
    setMatchNum((n) => n + 1);
    setPendingNext(false);
  };

  const ranked = useMemo(() => {
    return CHESS_MODELS
      .map((m) => ({ ...m, ...(leaderboard[m.id] || { wins: 0, losses: 0, draws: 0, games: 0 }) }))
      .sort((a, b) => b.wins - a.wins || b.games - a.games);
  }, [leaderboard]);

  return (
    <div className="ca-play">
      <div className="ca-play-header">
        <ModelBadge modelId={whiteModel} turnActive={chess.turn() === "w" && !status.over} thinking={thinking} />
        <span className="ca-vs">Match #{matchNum}</span>
        <ModelBadge modelId={blackModel} turnActive={chess.turn() === "b" && !status.over} thinking={thinking} />
      </div>
      <div className="ca-play-body">
        <div className="ca-board-col">
          <CapturedRow verboseHistory={verboseHistory} side="b" />
          <ChessBoard chess={chess} orientation="w" lastMove={lastMove} inCheck={status.check} />
          <CapturedRow verboseHistory={verboseHistory} side="w" />
          <ResultBanner status={status} whiteId={whiteModel} blackId={blackModel} />
          <CommentaryBubble commentary={commentary} />
        </div>
        <div className="ca-side-col">
          <div className="ca-controls">
            <button className="ca-btn-icon" onClick={() => setPlaying((p) => !p)} title={playing ? "Pause" : "Resume"}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="ca-btn-icon" onClick={skipToNext} title="Skip to next matchup"><Shuffle size={16} /> New matchup</button>
            <button className="ca-btn-icon" onClick={onExit} title="Back to modes"><ChevronLeft size={16} /> Modes</button>
          </div>
          <div className="ca-leaderboard">
            <h4><Trophy size={14} /> Leaderboard</h4>
            {ranked.map((m) => (
              <div className="ca-lb-row" key={m.id} style={{ "--mc": m.color }}>
                <span className="ca-mb-avatar">{m.avatar}</span>
                <span className="ca-lb-name">{m.name}</span>
                <span className="ca-lb-stats">{m.wins}W–{m.losses}L–{m.draws}D</span>
              </div>
            ))}
          </div>
          <MoveList history={historySAN} />
        </div>
      </div>
    </div>
  );
}

// ─── Player vs AI mode ──────────────────────────────────────────────────────
function PlayerVsAI({ onExit }) {
  const { chess, version, makeMove, reset } = useChessGame();
  const { thinking, commentary, setCommentary, doOneMove, cancel } = useAIMoveEngine();
  const [aiModel, setAiModel] = useState(CHESS_MODELS[0].id);
  const [playerColor, setPlayerColor] = useState("w");
  const [started, setStarted] = useState(false);
  const [selected, setSelected] = useState(null);
  const [resigned, setResigned] = useState(false);

  const aiColor = playerColor === "w" ? "b" : "w";
  // `chess` is a stable, mutated-in-place instance — `version` is what actually
  // signals a new position, so it must stay in every dependency array below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const status = useMemo(() => (resigned ? { over: true, result: aiColor, reason: "resignation", check: false } : getGameStatus(chess)), [chess, version, resigned, aiColor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historySAN = useMemo(() => chess.history(), [chess, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const verboseHistory = useMemo(() => chess.history({ verbose: true }), [chess, version]);
  const lastMove = verboseHistory.length ? verboseHistory[verboseHistory.length - 1] : null;
  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return chess.moves({ square: selected, verbose: true }).map((m) => m.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, selected, version]);

  useEffect(() => {
    if (!started || resigned) return;
    if (chess.isGameOver()) return;
    if (chess.turn() !== aiColor) return;
    doOneMove(chess, aiModel, makeMove, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, version, aiColor, aiModel, resigned]);

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

  const startGame = () => { setStarted(true); setResigned(false); };
  const resetAll = () => { cancel(); reset(); setCommentary(null); setStarted(false); setSelected(null); setResigned(false); };
  const rematch = () => { cancel(); reset(); setCommentary(null); setSelected(null); setResigned(false); setStarted(true); };

  if (!started) {
    return (
      <div className="ca-setup">
        <h3>Player vs AI</h3>
        <p className="ca-setup-sub">Choose your opponent and which side you'd like to play.</p>
        <div className="ca-setup-pickers">
          <div className="ca-setup-col">
            <span className="ca-setup-label">Opponent</span>
            {CHESS_MODELS.map((m) => (
              <button key={m.id} className={`ca-model-option ${aiModel === m.id ? "active" : ""}`} style={{ "--mc": m.color }} onClick={() => setAiModel(m.id)}>
                <span className="ca-mb-avatar">{m.avatar}</span>{m.name}
              </button>
            ))}
          </div>
          <div className="ca-setup-col">
            <span className="ca-setup-label">Your side</span>
            <button className={`ca-model-option ${playerColor === "w" ? "active" : ""}`} onClick={() => setPlayerColor("w")}><User size={14} /> White</button>
            <button className={`ca-model-option ${playerColor === "b" ? "active" : ""}`} onClick={() => setPlayerColor("b")}><User size={14} /> Black</button>
            <button className={`ca-model-option ${playerColor === "random" ? "active" : ""}`} onClick={() => setPlayerColor(Math.random() < 0.5 ? "w" : "b")}><Shuffle size={14} /> Random</button>
          </div>
        </div>
        <button className="ca-btn-primary" onClick={startGame}><Swords size={16} /> Start Game</button>
      </div>
    );
  }

  return (
    <div className="ca-play">
      <div className="ca-play-header">
        <ModelBadge modelId={aiModel} turnActive={chess.turn() === aiColor && !status.over} thinking={thinking} />
        <span className="ca-vs">You are {playerColor === "w" ? "White" : "Black"}</span>
        <div className={`ca-model-badge ca-mb-md ${chess.turn() === playerColor && !status.over ? "ca-mb-active" : ""}`} style={{ "--mc": "#9ca3af" }}>
          <span className="ca-mb-avatar"><User size={16} /></span>
          <span className="ca-mb-info"><span className="ca-mb-name">You</span></span>
        </div>
      </div>
      <div className="ca-play-body">
        <div className="ca-board-col">
          <CapturedRow verboseHistory={verboseHistory} side={aiColor} />
          <ChessBoard
            chess={chess}
            orientation={playerColor}
            lastMove={lastMove}
            selected={selected}
            legalTargets={legalTargets}
            onSquareClick={handleSquareClick}
            interactive={!status.over}
            inCheck={status.check}
          />
          <CapturedRow verboseHistory={verboseHistory} side={playerColor} />
          <ResultBanner status={status} whiteId={playerColor === "w" ? "you" : aiModel} blackId={playerColor === "b" ? "you" : aiModel} playerColor={playerColor} />
          <CommentaryBubble commentary={commentary} />
        </div>
        <div className="ca-side-col">
          <div className="ca-controls">
            {!status.over && <button className="ca-btn-icon" onClick={() => setResigned(true)} title="Resign"><Flag size={16} /> Resign</button>}
            {status.over ? (
              <button className="ca-btn-icon" onClick={rematch} title="Rematch"><RotateCcw size={16} /> Rematch</button>
            ) : (
              <button className="ca-btn-icon" onClick={resetAll} title="Reset"><RotateCcw size={16} /></button>
            )}
            <button className="ca-btn-icon" onClick={onExit} title="Back to modes"><ChevronLeft size={16} /> Modes</button>
          </div>
          <MoveList history={historySAN} />
        </div>
      </div>
    </div>
  );
}

// ─── mode picker menu ───────────────────────────────────────────────────────
function ModeMenu({ onPick }) {
  const cards = [
    { id: "ai-vs-ai", title: "AI vs AI", icon: Swords, desc: "Pick two models yourself and watch a head-to-head battle unfold." },
    { id: "spectator", title: "Spectator", icon: Eye, desc: "Sit back — random model matchups play continuously with a live leaderboard." },
    { id: "player-vs-ai", title: "Player vs AI", icon: User, desc: "Choose your side and take on any model yourself, one move at a time." },
  ];
  return (
    <div className="ca-menu">
      <div className="ca-menu-hero">
        <Sparkles size={22} />
        <h2>Chess Arena</h2>
        <p>Real AI models, real chess. Choose how you want to play.</p>
      </div>
      <div className="ca-menu-cards">
        {cards.map((c) => (
          <button key={c.id} className="ca-menu-card" onClick={() => onPick(c.id)}>
            <c.icon size={26} />
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── root ───────────────────────────────────────────────────────────────────
export default function ChessArena({ onClose }) {
  const [mode, setMode] = useState("menu");
  return (
    <div className="chess-arena" onClick={(e) => e.target === e.currentTarget && null}>
      <div className="ca-header">
        <div className="ca-header-left">
          <Bot size={18} />
          <span>Chess Arena</span>
          {mode !== "menu" && <button className="ca-back-link" onClick={() => setMode("menu")}><ChevronLeft size={14} /> Modes</button>}
        </div>
        <button className="ca-close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="ca-body">
        {mode === "menu" && <ModeMenu onPick={setMode} />}
        {mode === "ai-vs-ai" && <AIvAI onExit={() => setMode("menu")} />}
        {mode === "spectator" && <Spectator onExit={() => setMode("menu")} />}
        {mode === "player-vs-ai" && <PlayerVsAI onExit={() => setMode("menu")} />}
      </div>
    </div>
  );
}
