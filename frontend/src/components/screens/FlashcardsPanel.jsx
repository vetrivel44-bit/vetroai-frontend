import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Layers, Trash2, Volume2, X } from "lucide-react";
import { decks as deckList, dueCards, formatWait, nextDue, previewWaits, review } from "../../lib/flashcards";
import { speakText, stopSpeaking } from "../../lib/tts";
import { detectSpeechLanguage } from "../../lib/speechLanguage";
import { freeReadAloudVoice } from "../../lib/voiceStream";
import "./Flashcards.css";

const GRADE_LABELS = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

const say = (text) => {
  const lang = detectSpeechLanguage(text) || undefined;
  speakText(text, { voice: freeReadAloudVoice(lang) });
};

/**
 * Flashcards (lib/flashcards.js): the cards due now, your decks, and a review
 * session — read the question, try to recall, show the answer, and say how
 * well you remembered it; the card comes back when that says it should.
 * `onChange(cards)` saves the whole list; `onDelete(ids)` removes cards.
 */
export default function FlashcardsPanel({ cards = [], onChange, onDelete, onClose, startDeck = null }) {
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState(null); // { queue: [ids], done: n, total: n, deck }
  const [revealed, setRevealed] = useState(false);
  const [openDeck, setOpenDeck] = useState(null);
  const panelRef = useRef(null);

  // Due counts stay current while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(timer); stopSpeaking(); };
  }, []);

  const due = useMemo(() => dueCards(cards, now), [cards, now]);
  const allDecks = useMemo(() => deckList(cards, now), [cards, now]);
  const upcoming = nextDue(cards, now);
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const start = (deck = null) => {
    const queue = dueCards(cards, Date.now()).filter((card) => !deck || card.deck === deck).map((card) => card.id);
    if (!queue.length) return;
    setRevealed(false);
    setSession({ queue, done: 0, total: queue.length, deck });
  };
  // Opened from a deck's "Review" shortcut elsewhere in the app.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !startDeck) return;
    started.current = true;
    const queue = dueCards(cards, Date.now()).filter((card) => card.deck === startDeck).map((card) => card.id);
    if (queue.length) setTimeout(() => setSession({ queue, done: 0, total: queue.length, deck: startDeck }), 0);
  }, [startDeck, cards]);

  const current = session ? byId.get(session.queue[0]) : null;
  const waits = current ? previewWaits(current, now) : null;

  const grade = (name) => {
    if (!current || !revealed) return;
    const at = Date.now();
    const updated = review(current, name, at);
    onChange(cards.map((card) => (card.id === current.id ? updated : card)));
    stopSpeaking();
    setRevealed(false);
    setNow(at);
    setSession((s) => {
      const [, ...rest] = s.queue;
      // Forgotten: once more before this session ends.
      const queue = name === "again" ? [...rest, current.id] : rest;
      return { ...s, queue, done: s.done + (name === "again" ? 0 : 1) };
    });
  };

  // Space shows the answer; 1–4 answer it; Escape leaves the session.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") { e.preventDefault(); if (session) setSession(null); else onClose(); return; }
      if (!current) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setRevealed(true); return; }
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      if (revealed && index !== -1) { e.preventDefault(); grade(["again", "hard", "good", "easy"][index]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => { panelRef.current?.focus(); }, [session]);

  const removeCard = (id) => onDelete([id]);
  const removeDeck = (name) => {
    const ids = cards.filter((card) => card.deck === name).map((card) => card.id);
    if (ids.length && window.confirm(`Delete the ${ids.length} card${ids.length === 1 ? "" : "s"} in "${name}"?`)) onDelete(ids);
  };

  // ── Reviewing ─────────────────────────────────────────────────────────────
  if (session) {
    const finished = !current;
    const progress = session.total ? Math.min(100, Math.round((session.done / session.total) * 100)) : 0;
    return (
      <div className="fc-screen" role="dialog" aria-label="Review flashcards" tabIndex={-1} ref={panelRef}>
        <header className="fc-bar">
          <button type="button" className="fc-icon-btn" onClick={() => { stopSpeaking(); setSession(null); }} aria-label="Back to your flashcards"><ArrowLeft size={19} /></button>
          <div className="fc-bar-title">{finished ? "Done" : `${Math.min(session.done + 1, session.total)} of ${session.total}`}</div>
          <button type="button" className="fc-icon-btn" onClick={onClose} aria-label="Close flashcards"><X size={19} /></button>
        </header>
        <div className="fc-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

        {finished ? (
          <div className="fc-done">
            <div className="fc-done-mark" aria-hidden="true"><Layers size={26} /></div>
            <h2>Nice work</h2>
            <p>You reviewed {session.total} card{session.total === 1 ? "" : "s"}.{upcoming ? ` The next one comes back in ${formatWait(upcoming - now)}.` : ""}</p>
            <button type="button" className="fc-primary" onClick={() => setSession(null)}>Back to flashcards</button>
          </div>
        ) : (
          <div className="fc-study">
            <button
              type="button"
              className={`fc-card${revealed ? " is-revealed" : ""}`}
              onClick={() => setRevealed(true)}
              aria-label={revealed ? "Answer shown" : "Show the answer"}
            >
              <span className="fc-card-deck">{current.deck}</span>
              <span className="fc-card-front">{current.front}</span>
              {revealed && (
                <>
                  <span className="fc-card-rule" aria-hidden="true" />
                  <span className="fc-card-back">{current.back}</span>
                </>
              )}
            </button>
            <button type="button" className="fc-speak" onClick={() => say(revealed ? `${current.front}. ${current.back}` : current.front)} aria-label="Read the card aloud">
              <Volume2 size={16} /> Read aloud
            </button>

            <div className="fc-actions">
              {revealed ? (
                <>
                  <p className="fc-ask">How well did you remember it?</p>
                  <div className="fc-grades">
                    {["again", "hard", "good", "easy"].map((name, i) => (
                      <button key={name} type="button" className={`fc-grade is-${name}`} onClick={() => grade(name)} aria-keyshortcuts={String(i + 1)}>
                        <strong>{GRADE_LABELS[name]}</strong>
                        <span>{waits[name]}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button type="button" className="fc-primary fc-show" onClick={() => setRevealed(true)}>Show answer</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  return (
    <div className="fc-screen" role="dialog" aria-label="Flashcards" tabIndex={-1} ref={panelRef}>
      <header className="fc-bar">
        <button type="button" className="fc-icon-btn" onClick={onClose} aria-label="Close flashcards"><X size={19} /></button>
        <div className="fc-bar-title">Flashcards</div>
        <span className="fc-icon-btn" aria-hidden="true" />
      </header>

      <div className="fc-body">
        {!cards.length ? (
          <div className="fc-empty">
            <div className="fc-done-mark" aria-hidden="true"><Layers size={26} /></div>
            <h2>No flashcards yet</h2>
            <p>Tap <strong>Flashcards</strong> under any answer and VetroAI turns it into cards. Each card comes back after a day, three days, a week… just before you'd forget it.</p>
          </div>
        ) : (
          <>
            <section className="fc-hero" aria-live="polite">
              {due.length ? (
                <>
                  <div className="fc-hero-count">{due.length}</div>
                  <div className="fc-hero-label">card{due.length === 1 ? "" : "s"} to review</div>
                  <button type="button" className="fc-primary" onClick={() => start()}>Review now</button>
                </>
              ) : (
                <>
                  <div className="fc-hero-label fc-hero-calm">All caught up</div>
                  <p className="fc-hero-next">{upcoming ? `Next review in ${formatWait(upcoming - now)}.` : "Nothing due."}</p>
                </>
              )}
              <p className="fc-hero-how">Cards come back after a day, three days, a week… just before you'd forget them.</p>
            </section>

            <h3 className="fc-section">Your decks</h3>
            <ul className="fc-decks">
              {allDecks.map((deck) => {
                const open = openDeck === deck.name;
                const inDeck = cards.filter((card) => card.deck === deck.name).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                return (
                  <li key={deck.name} className={`fc-deck${open ? " is-open" : ""}`}>
                    <div className="fc-deck-row">
                      <button type="button" className="fc-deck-head" onClick={() => setOpenDeck(open ? null : deck.name)} aria-expanded={open}>
                        <span className="fc-deck-name">{deck.name}</span>
                        <span className="fc-deck-meta">
                          {deck.total} card{deck.total === 1 ? "" : "s"}
                          {deck.due ? <> · <b>{deck.due} due</b></> : null}
                          {deck.learned ? ` · ${deck.learned} learned` : ""}
                        </span>
                        <ChevronDown size={16} className="fc-deck-chevron" aria-hidden="true" />
                      </button>
                      {deck.due > 0 && <button type="button" className="fc-deck-review" onClick={() => start(deck.name)}>Review</button>}
                    </div>
                    {open && (
                      <div className="fc-deck-cards">
                        {inDeck.map((card) => (
                          <div key={card.id} className="fc-mini">
                            <div className="fc-mini-text">
                              <span className="fc-mini-front">{card.front}</span>
                              <span className="fc-mini-back">{card.back}</span>
                              <span className="fc-mini-due">{(card.due || 0) <= now ? "Due now" : `Due in ${formatWait(card.due - now)}`}</span>
                            </div>
                            <button type="button" className="fc-icon-btn fc-mini-delete" onClick={() => removeCard(card.id)} aria-label={`Delete the card "${card.front}"`}><Trash2 size={15} /></button>
                          </div>
                        ))}
                        <button type="button" className="fc-delete-deck" onClick={() => removeDeck(deck.name)}><Trash2 size={14} /> Delete deck</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
