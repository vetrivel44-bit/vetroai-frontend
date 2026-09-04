// Chess Arena — playing identities.
//
// Every model searches with the same engine, but through a different set of
// eyes: the style weights below feed straight into the evaluation, so two
// personas genuinely disagree about which move is best rather than picking the
// same move and describing it differently.
//
// On top of the fixed identity, each game draws a "mood" that nudges those
// weights and picks an opening preference, so a given pairing never plays the
// same game twice.

import { makeStyle } from "./chessEngine.js";

// ─── deterministic per-game randomness ──────────────────────────────────────
// Seeded so a game is reproducible from its id, and so both sides of a game
// derive their moods from the same source without coordinating.
export function makeSeededRandom(seed) {
  let s = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ─── personas ───────────────────────────────────────────────────────────────
// thinkMs   — search budget, so some models genuinely calculate deeper
// discipline— how closely it sticks to the engine's top choice (0..1). Lower
//             means more willing to play a slightly worse but characterful
//             move, which is what makes the games feel human rather than
//             like two copies of the same engine trading best moves.
// tolerance — how much eval it will give up for a move that fits its style,
//             in centipawns. Also the blunder-veto threshold.
export const PERSONAS = {
  agnes: {
    label: "Agnes 2.0",
    school: "Universal — Karpov's squeeze with Kasparov's punch",
    thinkMs: 900,
    discipline: 0.86,
    tolerance: 45,
    style: makeStyle({ material: 1.0, kingAttack: 1.1, mobility: 1.15, pawnStructure: 1.1, kingSafety: 1.05, centre: 1.1, initiative: 0.4 }),
    doctrine: [
      "Improve your worst-placed piece before starting anything sharp.",
      "Trade when it takes you toward a better endgame, not to relieve tension.",
      "Prefer a small permanent edge (structure, outpost, bishop pair) to a temporary one.",
    ],
    voice: "measured and quietly confident, like a coach who has seen this position before",
  },
  chatgpt: {
    label: "ChatGPT",
    school: "Classical positional — Capablanca's clarity",
    thinkMs: 850,
    discipline: 0.9,
    tolerance: 35,
    style: makeStyle({ material: 1.05, kingAttack: 0.85, mobility: 1.1, pawnStructure: 1.35, kingSafety: 1.2, centre: 1.15, initiative: 0.1, contempt: -1 }),
    doctrine: [
      "Structure first: avoid creating weaknesses you will have to babysit later.",
      "Occupy open files with rooks and outposts with knights.",
      "Simplify into a favourable endgame whenever you are the one holding an edge.",
    ],
    voice: "calm and instructive, explaining the plan rather than the tactic",
  },
  fable: {
    label: "Fable",
    school: "Romantic attacking chess — the Morphy tradition",
    thinkMs: 950,
    discipline: 0.72,
    tolerance: 90,
    style: makeStyle({ material: 0.82, kingAttack: 1.65, mobility: 1.3, pawnStructure: 0.75, kingSafety: 0.85, centre: 1.1, initiative: 1.0, contempt: 2 }),
    doctrine: [
      "Development and open lines are worth more than a pawn — often more than two.",
      "If a sacrifice opens the enemy king, calculate it first and trust it if the lines hold.",
      "Never trade queens while you still have an attack.",
    ],
    voice: "theatrical and daring, narrating the game like a story with stakes",
  },
  gemini: {
    label: "Gemini",
    school: "Concrete calculation — everything is a tactic",
    thinkMs: 1100,
    discipline: 0.94,
    tolerance: 30,
    style: makeStyle({ material: 1.1, kingAttack: 1.2, mobility: 1.05, pawnStructure: 0.95, kingSafety: 1.0, centre: 1.0, initiative: 0.5 }),
    doctrine: [
      "Check every forcing move first: checks, captures, threats — in that order.",
      "Trust the calculation over the general principle when they disagree.",
      "Look for the in-between move before recapturing automatically.",
    ],
    voice: "precise and clipped, quoting concrete lines rather than vague plans",
  },
  groq: {
    label: "Groq",
    school: "Rapid-fire pressure — Tal's chaos on a clock",
    thinkMs: 750,
    discipline: 0.7,
    tolerance: 100,
    style: makeStyle({ material: 0.85, kingAttack: 1.55, mobility: 1.4, pawnStructure: 0.8, kingSafety: 0.9, centre: 1.05, initiative: 1.2, contempt: 3 }),
    doctrine: [
      "Keep the initiative at all costs — a move that forces a reply beats a quiet improvement.",
      "Complicate when the position is level; the side with more threats wins the muddle.",
      "Push the h-pawn at the castled king when you have pieces to follow it up.",
    ],
    voice: "fast, brash, and a little cocky",
  },
  mistral: {
    label: "Mistral",
    school: "European technique — Petrosian's prophylaxis",
    thinkMs: 900,
    discipline: 0.92,
    tolerance: 30,
    style: makeStyle({ material: 1.12, kingAttack: 0.8, mobility: 1.0, pawnStructure: 1.3, kingSafety: 1.45, centre: 1.05, initiative: 0, contempt: -2 }),
    doctrine: [
      "Ask what the opponent wants to do, and take it away before doing anything else.",
      "Do not open the position while your king is the less safe one.",
      "A tiny material edge, carefully converted, is a whole point.",
    ],
    voice: "dry, exact, faintly amused by the opponent's optimism",
  },
  sambanova: {
    label: "SambaNova",
    school: "Hypermodern — cede the centre, then break it",
    thinkMs: 850,
    discipline: 0.78,
    tolerance: 70,
    style: makeStyle({ material: 0.95, kingAttack: 1.25, mobility: 1.35, pawnStructure: 0.9, kingSafety: 1.0, centre: 0.85, initiative: 0.8, contempt: 1 }),
    doctrine: [
      "Let the opponent build a big centre, then undermine it with a flank pawn break.",
      "Fianchettoed bishops are long-term assets — do not trade them cheaply.",
      "Prefer the move that keeps more pieces on when you have the more flexible position.",
    ],
    voice: "bold and unorthodox, enjoying the road less travelled",
  },
  openrouter: {
    label: "OpenRouter",
    school: "Adaptive — borrows whichever school fits the position",
    thinkMs: 900,
    discipline: 0.84,
    tolerance: 55,
    style: makeStyle({ material: 1.0, kingAttack: 1.15, mobility: 1.2, pawnStructure: 1.05, kingSafety: 1.05, centre: 1.05, initiative: 0.5 }),
    doctrine: [
      "Match the plan to the structure rather than to a favourite idea.",
      "Punish a slow move immediately; sit tight against a good one.",
      "Keep at least two plans alive so the opponent cannot defend against one.",
    ],
    voice: "versatile and analytical, switching register to suit the position",
  },
};

export function getPersona(id) {
  return PERSONAS[id] || PERSONAS.agnes;
}

// ─── per-game moods ─────────────────────────────────────────────────────────
// Drawn once per game per side. These are deliberately strong enough to change
// move choice — that is the point — but bounded so nobody starts blundering.
export const MOODS = [
  {
    id: "sharp",
    label: "in a sharp mood",
    note: "You are looking for the critical, forcing continuation today.",
    weights: { kingAttack: 0.25, initiative: 0.4, material: -0.06 },
    disciplineShift: -0.05,
  },
  {
    id: "patient",
    label: "playing patiently",
    note: "You are happy to improve slowly and let the opponent commit first.",
    weights: { pawnStructure: 0.2, kingSafety: 0.2, kingAttack: -0.2 },
    disciplineShift: 0.06,
  },
  {
    id: "greedy",
    label: "feeling greedy",
    note: "You will take material and back your technique to convert it.",
    weights: { material: 0.14, kingAttack: -0.1 },
    disciplineShift: 0.02,
  },
  {
    id: "provocative",
    label: "feeling provocative",
    note: "You want to unbalance the position early and invite a mistake.",
    weights: { mobility: 0.25, centre: -0.15, initiative: 0.3 },
    disciplineShift: -0.08,
  },
  {
    id: "endgame",
    label: "steering for an endgame",
    note: "You are aiming to trade into a technical position you know how to win.",
    weights: { pawnStructure: 0.25, material: 0.08, kingAttack: -0.25 },
    disciplineShift: 0.04,
  },
  {
    id: "gambit",
    label: "in a gambit mood",
    note: "You will invest a pawn for development and open lines without hesitating.",
    weights: { material: -0.16, initiative: 0.5, kingAttack: 0.2 },
    disciplineShift: -0.1,
  },
  {
    id: "prophylactic",
    label: "playing prophylactically",
    note: "Your first question every move is what the opponent is threatening.",
    weights: { kingSafety: 0.3, pawnStructure: 0.15, initiative: -0.2 },
    disciplineShift: 0.05,
  },
];

// ─── opening repertoire ─────────────────────────────────────────────────────
// Short, sound mainlines keyed by the move sequence played so far. Book moves
// keep the early game varied and stop the models from drifting into a bad
// structure before the search has anything concrete to work with.
const BOOK = {
  "": {
    e4: ["Open Game", ["sharp", "gambit", "provocative"]],
    d4: ["Queen's Pawn", ["patient", "endgame", "prophylactic"]],
    Nf3: ["Réti", ["patient", "provocative"]],
    c4: ["English", ["patient", "endgame"]],
    g3: ["King's Fianchetto", ["provocative"]],
  },
  e4: {
    e5: ["Open Game", ["sharp", "gambit"]],
    c5: ["Sicilian", ["sharp", "provocative", "gambit"]],
    e6: ["French", ["patient", "prophylactic"]],
    c6: ["Caro-Kann", ["patient", "endgame", "prophylactic"]],
    d5: ["Scandinavian", ["provocative"]],
    Nf6: ["Alekhine", ["provocative"]],
    g6: ["Modern", ["provocative"]],
  },
  d4: {
    Nf6: ["Indian Defence", ["patient", "provocative"]],
    d5: ["Closed Game", ["patient", "endgame"]],
    f5: ["Dutch", ["sharp", "provocative"]],
    e6: ["Queen's Pawn", ["patient"]],
  },
  "e4 e5": {
    Nf3: ["King's Knight", ["sharp", "patient"]],
    f4: ["King's Gambit", ["gambit", "sharp"]],
    Nc3: ["Vienna", ["provocative", "sharp"]],
    Bc4: ["Bishop's Opening", ["sharp"]],
  },
  "e4 c5": {
    Nf3: ["Open Sicilian", ["sharp"]],
    Nc3: ["Closed Sicilian", ["patient"]],
    c3: ["Alapin", ["patient", "endgame"]],
    d4: ["Smith-Morra", ["gambit"]],
  },
  "e4 e5 Nf3": {
    Nc6: ["Two Knights territory", ["sharp", "patient"]],
    d6: ["Philidor", ["patient", "prophylactic"]],
    Nf6: ["Petrov", ["patient", "endgame"]],
  },
  "e4 e5 Nf3 Nc6": {
    Bb5: ["Ruy López", ["patient", "sharp"]],
    Bc4: ["Italian Game", ["sharp", "gambit"]],
    d4: ["Scotch", ["sharp"]],
    Nc3: ["Four Knights", ["patient"]],
  },
  "d4 Nf6": {
    c4: ["Indian Systems", ["patient", "sharp"]],
    Nf3: ["London / Réti setups", ["patient", "prophylactic"]],
    Bg5: ["Trompowsky", ["provocative"]],
  },
  "d4 d5": {
    c4: ["Queen's Gambit", ["patient", "endgame"]],
    Nf3: ["Quiet Queen's Pawn", ["patient"]],
    Bf4: ["London System", ["prophylactic", "patient"]],
  },
  "d4 Nf6 c4": {
    e6: ["Nimzo/Queen's Indian complex", ["patient", "prophylactic"]],
    g6: ["King's Indian / Grünfeld", ["sharp", "provocative"]],
    c5: ["Benoni", ["sharp", "provocative"]],
  },
};

// Returns a book move for the current position, or null once out of book.
// `legalSans` gates it so a book entry can never produce an illegal move.
export function bookMove(historySans, legalSans, rng, moodId) {
  const key = historySans.slice(0, 4).join(" ");
  const entry = BOOK[key];
  if (!entry) return null;

  const options = Object.entries(entry).filter(([san]) => legalSans.includes(san));
  if (!options.length) return null;

  // Prefer lines that match today's mood; fall back to the whole book entry.
  const onMood = options.filter(([, [, moods]]) => moods.includes(moodId));
  const pool = onMood.length ? onMood : options;
  const [san, [name]] = pick(rng, pool);
  return { san, name };
}

export function openingName(historySans) {
  // Walk back from the most recent move so the deepest name wins: after
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 this is a Ruy López, not the Two Knights position
  // it passed through on move two.
  for (let i = Math.min(historySans.length, 5) - 1; i >= 0; i--) {
    const entry = BOOK[historySans.slice(0, i).join(" ")];
    const played = historySans[i];
    if (entry && entry[played]) return entry[played][0];
  }
  return null;
}

// ─── per-game identity ──────────────────────────────────────────────────────
// Combines the fixed persona with a mood drawn from the game seed, producing
// the style the engine will actually search with this game.
export function buildGameIdentity(providerId, gameSeed, color) {
  const persona = getPersona(providerId);
  const rng = makeSeededRandom(`${gameSeed}:${providerId}:${color}`);
  const mood = pick(rng, MOODS);

  const style = { ...persona.style };
  for (const [key, delta] of Object.entries(mood.weights)) {
    style[key] = (style[key] ?? 0) + delta;
  }
  // Keep the dials in a sane band — a mood colours the play, it does not
  // turn a persona into a different engine.
  style.material = Math.min(1.3, Math.max(0.7, style.material));
  style.kingAttack = Math.min(2, Math.max(0.5, style.kingAttack));
  style.mobility = Math.min(1.8, Math.max(0.6, style.mobility));
  style.pawnStructure = Math.min(1.8, Math.max(0.5, style.pawnStructure));
  style.kingSafety = Math.min(1.8, Math.max(0.5, style.kingSafety));

  const discipline = Math.min(0.97, Math.max(0.55, persona.discipline + mood.disciplineShift));

  return {
    providerId,
    persona,
    mood,
    style,
    discipline,
    tolerance: persona.tolerance,
    thinkMs: persona.thinkMs,
    rng,
  };
}
