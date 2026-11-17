// Flashcards with spaced repetition: each card comes back just before you'd
// forget it.
//
// Reviewing a card, you say how well you remembered it, and that sets when it
// comes back:
//   Again  forgot it: back in 10 minutes (and it counts as a lapse);
//   Hard   remembered with effort: a little longer than last time (a new
//          card: in 6 hours);
//   Good   remembered: 1 day, then 3 days, then a week, then about 2½× longer
//          each time (2½ weeks, 6 weeks…);
//   Easy   remembered at once: further still (3 days, then a week, then more).
// Each card keeps an "ease": Hard and Again lower it (it comes back sooner
// from then on), Easy raises it. That's the SM-2 idea behind Anki, kept
// simple and predictable.
//
// Cards are kept per person: on the device, and in their account when signed
// in (App.jsx, Firestore users/{uid}/flashcards). A card reviewed on two
// devices keeps its latest review (mergeCards).

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
const RELEARN_MS = 10 * MINUTE;
const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.2;

export const GRADES = ["again", "hard", "good", "easy"];

const newId = (now) => `fc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clampEase = (ease) => Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(ease * 100) / 100));

/** A new card, due now. `deck` groups cards by topic. */
export function makeCard({ front, back, deck = "", source = "" }, now = Date.now()) {
  return {
    id: newId(now),
    front: String(front || "").trim(),
    back: String(back || "").trim(),
    deck: String(deck || "").trim() || "My cards",
    source: String(source || "").slice(0, 300),
    createdAt: now,
    updatedAt: now,
    due: now,
    interval: 0, // days until the next review, once learned
    ease: START_EASE,
    reps: 0, // successful reviews in a row
    lapses: 0,
  };
}

/** How many days the next review is after `grade`, for a card in its current state. */
function nextInterval(card, grade) {
  const reps = card.reps || 0;
  const interval = card.interval || 0;
  const ease = card.ease || START_EASE;
  if (grade === "again") return 0;
  // A new card that was hard: the same day, a few hours on.
  if (grade === "hard") return reps === 0 ? 0.25 : Math.max(1, Math.round(interval * 1.2));
  if (grade === "good") {
    if (reps === 0) return 1;
    if (reps === 1) return 3;
    if (interval < 7) return 7;
    return Math.round(interval * ease);
  }
  // easy: always further than Good would be
  if (reps === 0) return 3;
  if (reps === 1) return 7;
  return Math.max(nextInterval(card, "good") + 2, Math.round(interval * ease * 1.3));
}

/** The card after reviewing it with `grade` ("again" | "hard" | "good" | "easy"). */
export function review(card, grade, now = Date.now()) {
  if (!GRADES.includes(grade)) throw new Error(`Unknown grade: ${grade}`);
  const interval = nextInterval(card, grade);
  const ease = clampEase((card.ease || START_EASE) + { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }[grade]);
  if (grade === "again") {
    return {
      ...card,
      ease,
      interval: 0,
      reps: 0,
      lapses: (card.lapses || 0) + ((card.reps || 0) > 0 ? 1 : 0),
      due: now + RELEARN_MS,
      updatedAt: now,
      lastReviewedAt: now,
    };
  }
  return {
    ...card,
    ease,
    interval,
    reps: (card.reps || 0) + 1,
    due: now + interval * DAY,
    updatedAt: now,
    lastReviewedAt: now,
  };
}

/** "10 min", "1 day", "3 days", "1 week", "10 days", "3 weeks", "2 months". */
export function formatWait(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  if (days === 7) return "1 week";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) { const weeks = Math.round(days / 7); return `${weeks} week${weeks === 1 ? "" : "s"}`; }
  if (days < 365) { const months = Math.round(days / 30); return `${months} month${months === 1 ? "" : "s"}`; }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

/** What each answer button would mean for this card: { again: "10 min", good: "1 day", … }. */
export function previewWaits(card, now = Date.now()) {
  return Object.fromEntries(GRADES.map((grade) => [grade, formatWait(review(card, grade, now).due - now)]));
}

/** Cards due now, the longest-waiting first (new cards after reviews, oldest first). */
export function dueCards(cards, now = Date.now()) {
  return (cards || [])
    .filter((card) => card && (card.due || 0) <= now)
    .sort((a, b) => (a.reps === 0) - (b.reps === 0) || (a.due || 0) - (b.due || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** When the next card is due, or null with no cards. */
export function nextDue(cards, now = Date.now()) {
  const upcoming = (cards || []).map((card) => card.due || 0).filter((due) => due > now);
  return upcoming.length ? Math.min(...upcoming) : null;
}

/** Decks by name: [{ name, total, due, learned }], the ones with cards due first. */
export function decks(cards, now = Date.now()) {
  const byName = new Map();
  for (const card of cards || []) {
    const name = card.deck || "My cards";
    const deck = byName.get(name) || { name, total: 0, due: 0, learned: 0, latest: 0 };
    deck.total += 1;
    if ((card.due || 0) <= now) deck.due += 1;
    if ((card.interval || 0) >= 7) deck.learned += 1;
    deck.latest = Math.max(deck.latest, card.createdAt || 0);
    byName.set(name, deck);
  }
  return [...byName.values()].sort((a, b) => (b.due > 0) - (a.due > 0) || b.latest - a.latest).map((deck) => ({ name: deck.name, total: deck.total, due: deck.due, learned: deck.learned }));
}

const sameText = (a, b) => String(a).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === String(b).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * New cards for `deck` from the server's { front, back } list, leaving out any
 * whose question is already in that deck. Returns { added, cards }.
 */
export function addCards(existing, incoming, { deck, source = "" } = {}, now = Date.now()) {
  const list = [...(existing || [])];
  const added = [];
  for (const item of incoming || []) {
    const front = String(item?.front || "").trim();
    const back = String(item?.back || "").trim();
    if (!front || !back) continue;
    const name = String(deck || "").trim() || "My cards";
    if (list.some((card) => (card.deck || "My cards") === name && sameText(card.front, front))) continue;
    const card = makeCard({ front, back, deck: name, source }, now + added.length);
    list.push(card);
    added.push(card);
  }
  return { added, cards: list };
}

/**
 * A device's cards and the account's, merged by id: the more recently changed
 * copy of each card wins (a review on the phone isn't undone by the laptop's
 * older copy), and deleted cards stay deleted.
 */
export function mergeCards(remote, local, deleted = []) {
  const dead = new Set((deleted || []).map(String));
  const byId = new Map();
  for (const card of [...(local || []), ...(remote || [])]) {
    if (!card?.id || dead.has(String(card.id))) continue;
    const held = byId.get(card.id);
    if (!held || (card.updatedAt || 0) > (held.updatedAt || 0)) byId.set(card.id, card);
  }
  return [...byId.values()];
}

/**
 * Asks the server for flashcards from an answer (POST /api/flashcards).
 * Resolves to { deck, cards: [{ front, back }] }.
 */
export async function requestFlashcards(apiBase, { text, topic = "" }, { fetchImpl = globalThis.fetch, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(`${apiBase}/flashcards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(text || "").slice(0, 12000), topic: String(topic || "").slice(0, 300) }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach VetroAI. Check your connection and try again.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(body?.message || "Couldn't make flashcards right now. Try again in a moment.");
  const data = body?.data ?? body ?? {};
  return { deck: String(data.deck || ""), cards: Array.isArray(data.cards) ? data.cards : [] };
}
