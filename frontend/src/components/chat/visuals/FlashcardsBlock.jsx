import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Layers, Lightbulb, RotateCcw, Shuffle, Undo2 } from "lucide-react";
import { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { deckSummary, deckToTsv, parseFlashcards, shuffled } from "../../../lib/flashcards";
import "./visuals.css";
import "./flashcards.css";

// A ```flashcards block: a study deck played inside the chat reply. Tap the
// card (or press Space) to flip it, then mark it "Got it" or "Still learning".
// At the end the learner sees how many they know and can review just the
// ones they missed, as many rounds as it takes.

function downloadDeck(deck) {
  const blob = new Blob([deckToTsv(deck)], { type: "text/tab-separated-values" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${deck.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "flashcards"}.tsv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Summary({ total, known, round, onReview, onRestart }) {
  const s = deckSummary(total, known);
  return (
    <div className="vfc-summary">
      <div className="vfc-ring" style={{ "--p": `${s.percent * 3.6}deg` }} aria-hidden="true">
        <span>{s.percent}%</span>
      </div>
      <div className="vfc-summary-text">
        <strong>{known} of {total} known{round > 1 ? ` · round ${round}` : ""}</strong>
        <span>{s.verdict}</span>
      </div>
      <div className="vfc-summary-actions">
        {s.learning > 0 && (
          <button type="button" className="vfc-btn is-primary" onClick={onReview}>
            <Undo2 size={15} /> Review {s.learning} still learning
          </button>
        )}
        <button type="button" className="vfc-btn" onClick={onRestart}><RotateCcw size={15} /> Start over</button>
      </div>
    </div>
  );
}

export default function FlashcardsBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { deck: parseFlashcards(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  const deck = parsed?.deck;
  // The cards in play this round (ids), where we are, and how each was marked.
  const [order, setOrder] = useState(null);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [marks, setMarks] = useState({}); // id -> "known" | "learning"
  const [round, setRound] = useState(1);
  const cardRef = useRef(null);

  const ids = order || (deck ? deck.cards.map((c) => c.id) : []);
  const total = ids.length;
  const done = deck && pos >= total;
  const card = deck && !done ? deck.cards[ids[pos]] : null;
  const knownInRound = ids.filter((id) => marks[id] === "known").length;

  const go = useCallback((next) => {
    setPos(next);
    setFlipped(false);
    setShowHint(false);
  }, []);
  // Keys keep working after a click: the button that had focus may be gone.
  const refocus = () => requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));

  const mark = useCallback((value) => {
    if (!card) return;
    setMarks((m) => ({ ...m, [card.id]: value }));
    go(pos + 1);
  }, [card, go, pos]);

  if (pending) return <VisualPending icon={Layers} label="Making your flashcards…" />;
  if (parsed?.error) return <VisualFallback what="flashcards" error={parsed.error} fallback={fallback} />;

  const restart = () => { setOrder(null); setMarks({}); setRound(1); go(0); };
  const shuffle = () => { setOrder(shuffled(ids)); setMarks({}); go(0); };
  const review = () => {
    const missed = ids.filter((id) => marks[id] !== "known");
    setOrder(missed);
    setMarks({});
    setRound((r) => r + 1);
    go(0);
  };

  const onKey = (e) => {
    if (done) return;
    // A focused button keeps Space and Enter for itself.
    if ((e.key === " " || e.key === "Enter") && e.target.tagName === "BUTTON") return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (pos < total - 1) go(pos + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (pos > 0) go(pos - 1); }
    else if (flipped && e.key === "1") mark("learning");
    else if (flipped && e.key === "2") mark("known");
  };

  const progress = total ? (Math.min(pos, total) / total) * 100 : 0;

  return (
    <div className="vfc not-prose" onKeyDown={onKey}>
      <div className="vfc-head">
        <span className="vfc-title"><Layers size={17} /> {deck.title}</span>
        <span className="vfc-tools">
          <button type="button" className="vfc-icon" onClick={shuffle} title="Shuffle" aria-label="Shuffle the cards"><Shuffle size={15} /></button>
          <button type="button" className="vfc-icon" onClick={restart} title="Start over" aria-label="Start over"><RotateCcw size={15} /></button>
          <button type="button" className="vfc-icon" onClick={() => downloadDeck(deck)} title="Download for Anki or Quizlet" aria-label="Download the deck"><Download size={15} /></button>
        </span>
      </div>

      <div className="vfc-progress">
        <span>{done ? "Round complete" : `Card ${pos + 1} of ${total}`}{round > 1 ? ` · review round ${round}` : ""}</span>
        <span className="vfc-bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
        <span className="vfc-tally">
          <span className="is-known" title="Got it"><Check size={12} /> {knownInRound}</span>
          <span className="is-learning" title="Still learning">↻ {ids.filter((id) => marks[id] === "learning").length}</span>
        </span>
      </div>

      {done ? (
        <Summary total={total} known={knownInRound} round={round} onReview={review} onRestart={restart} />
      ) : (
        <>
          <div
            ref={cardRef}
            className={`vfc-card${flipped ? " is-flipped" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={flipped}
            aria-label={flipped ? `Answer: ${card.back}. Press Space to see the question.` : `Question: ${card.front}. Press Space to see the answer.`}
            onClick={() => setFlipped((f) => !f)}
          >
            <div className="vfc-inner">
              <div className="vfc-face vfc-front" aria-hidden={flipped}>
                <span className="vfc-label">Question</span>
                <div className="vfc-text">{card.front}</div>
                {card.hint && (showHint
                  ? <p className="vfc-hint"><Lightbulb size={14} /> {card.hint}</p>
                  : <button type="button" className="vfc-hint-btn" onClick={(e) => { e.stopPropagation(); setShowHint(true); }}><Lightbulb size={14} /> Show hint</button>)}
                <span className="vfc-tap">Tap to flip</span>
              </div>
              <div className="vfc-face vfc-back" aria-hidden={!flipped}>
                <span className="vfc-label">Answer</span>
                <div className="vfc-text">{card.back}</div>
                {card.example && <p className="vfc-example"><strong>Example:</strong> {card.example}</p>}
              </div>
            </div>
          </div>

          <div className="vfc-actions">
            <button type="button" className="vfc-nav" onClick={() => go(pos - 1)} disabled={pos === 0} aria-label="Previous card"><ChevronLeft size={18} /></button>
            {flipped ? (
              <div className="vfc-grade">
                <button type="button" className="vfc-btn is-learning" onClick={() => { mark("learning"); refocus(); }}>↻ Still learning</button>
                <button type="button" className="vfc-btn is-known" onClick={() => { mark("known"); refocus(); }}><Check size={15} /> Got it</button>
              </div>
            ) : (
              <button type="button" className="vfc-btn is-primary" onClick={() => { setFlipped(true); cardRef.current?.focus({ preventScroll: true }); }}>Show answer</button>
            )}
            <button type="button" className="vfc-nav" onClick={() => go(pos + 1)} disabled={pos >= total - 1} aria-label="Next card"><ChevronRight size={18} /></button>
          </div>
          <p className="vfc-keys">Space flips · ← → move · 1 still learning · 2 got it</p>
        </>
      )}
    </div>
  );
}
