// Chess Arena — search engine.
//
// chess.js is used for game state everywhere else in the arena, but it only
// generates about 11k nodes/sec, which caps a search at roughly depth 4 inside
// a sane time budget. This is a self-contained 0x88 engine used purely for
// analysis: it runs two orders of magnitude faster, so the arena can search
// deep enough to actually punish a mistake.
//
// It exists for three jobs:
//   1. give the language models a real tactical brief of the position,
//   2. veto a move that hangs material or walks into mate,
//   3. stand in when a model returns something unparseable — previously that
//      fell back to a *random* legal move, which is where most of the
//      "the AIs play basic chess" came from.
//
// Everything here is plain data + typed arrays; no allocation in the hot path.

// ─── piece + board encoding ─────────────────────────────────────────────────
export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

// piece byte = type | (color << 3); 0 means empty.
const pieceOf = (type, color) => type | (color << 3);
const typeOf = (p) => p & 7;
const colorOf = (p) => (p >> 3) & 1;

const EMPTY = 0;

// 0x88: a square is on the real board when (sq & 0x88) === 0.
const onBoard = (sq) => (sq & 0x88) === 0;
const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 4;
// 0x88 square 0 is a1, so rank 0 is White's back rank.
const sq0x88 = (file, rank) => (rank << 4) | file;
const squareName = (sq) => "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1);
const nameToSquare = (name) => sq0x88(name.charCodeAt(0) - 97, name.charCodeAt(1) - 49);

// ─── move encoding (single int32) ───────────────────────────────────────────
// from:7 | to:7 | captured:4 | promotion:4 | flags:5
const FLAG_CAPTURE = 1;
const FLAG_EP = 2;
const FLAG_CASTLE = 4;
const FLAG_DOUBLE = 8;
const FLAG_PROMO = 16;

const encodeMove = (from, to, captured, promo, flags) =>
  from | (to << 7) | (captured << 14) | (promo << 18) | (flags << 22);

const moveFrom = (m) => m & 0x7f;
const moveTo = (m) => (m >> 7) & 0x7f;
const moveCaptured = (m) => (m >> 14) & 0xf;
const movePromo = (m) => (m >> 18) & 0xf;
const moveFlags = (m) => (m >> 22) & 0x1f;

// ─── castling rights bits ───────────────────────────────────────────────────
const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

// ─── movement vectors ───────────────────────────────────────────────────────
const KNIGHT_DELTAS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_DELTAS = [-17, -15, 15, 17];
const ROOK_DELTAS = [-16, -1, 1, 16];
const KING_DELTAS = [-17, -16, -15, -1, 1, 15, 16, 17];

// ─── zobrist hashing ────────────────────────────────────────────────────────
// A small deterministic PRNG keeps hashes stable across reloads, which makes
// engine behaviour reproducible for a given position.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

const ZOBRIST_PIECE = new Uint32Array(16 * 128);
const ZOBRIST_LOCK = new Uint32Array(16 * 128);
const ZOBRIST_CASTLE = new Uint32Array(16);
const ZOBRIST_CASTLE_LOCK = new Uint32Array(16);
const ZOBRIST_EP = new Uint32Array(128);
const ZOBRIST_EP_LOCK = new Uint32Array(128);
let ZOBRIST_SIDE = 0;
let ZOBRIST_SIDE_LOCK = 0;
(function initZobrist() {
  const rng = makeRng(0x9e3779b9);
  for (let i = 0; i < ZOBRIST_PIECE.length; i++) { ZOBRIST_PIECE[i] = rng(); ZOBRIST_LOCK[i] = rng(); }
  for (let i = 0; i < 16; i++) { ZOBRIST_CASTLE[i] = rng(); ZOBRIST_CASTLE_LOCK[i] = rng(); }
  for (let i = 0; i < 128; i++) { ZOBRIST_EP[i] = rng(); ZOBRIST_EP_LOCK[i] = rng(); }
  ZOBRIST_SIDE = rng(); ZOBRIST_SIDE_LOCK = rng();
})();

// ─── piece values ───────────────────────────────────────────────────────────
const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0];
const EG_VALUE = [0, 94, 281, 297, 512, 936, 0];
// Used for move ordering and the material read-outs shown to the models.
export const SIMPLE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

// Game-phase weights (24 = full opening material).
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const TOTAL_PHASE = 24;

// ─── piece-square tables (white's point of view, a1 = index 0) ──────────────
// Midgame/endgame pairs, tapered at eval time. Values are in centipawns and
// follow the well-trodden PeSTO shape: knights want the centre, rooks want the
// 7th, kings hide in the opening and march in the endgame.
const PST_MG = {
  [PAWN]: [
      0,   0,   0,   0,   0,   0,   0,   0,
    -35,  -1, -20, -23, -15,  24,  38, -22,
    -26,  -4,  -4, -10,   3,   3,  33, -12,
    -27,  -2,  -5,  12,  17,   6,  10, -25,
    -14,  13,   6,  21,  23,  12,  17, -23,
     -6,   7,  26,  31,  65,  56,  25, -20,
     98, 134,  61,  95,  68, 126,  34, -11,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [KNIGHT]: [
   -105, -21, -58, -33, -17, -28, -19, -23,
    -29, -53, -12,  -3,  -1,  18, -14, -19,
    -23,  -9,  12,  10,  19,  17,  25, -16,
    -13,   4,  16,  13,  28,  19,  21,  -8,
     -9,  17,  19,  53,  37,  69,  18,  22,
    -47,  60,  37,  65,  84, 129,  73,  44,
    -73, -41,  72,  36,  23,  62,   7, -17,
   -167, -89, -34, -49,  61, -97, -15,-107,
  ],
  [BISHOP]: [
    -33,  -3, -14, -21, -13, -12, -39, -21,
      4,  15,  16,   0,   7,  21,  33,   1,
      0,  15,  15,  15,  14,  27,  18,  10,
     -6,  13,  13,  26,  34,  12,  10,   4,
     -4,   5,  19,  50,  37,  37,   7,  -2,
    -16,  37,  43,  40,  35,  50,  37,  -2,
    -26,  16, -18, -13,  30,  59,  18, -47,
    -29,   4, -82, -37, -25, -42,   7,  -8,
  ],
  [ROOK]: [
    -19, -13,   1,  17,  16,   7, -37, -26,
    -44, -16, -20,  -9,  -1,  11,  -6, -71,
    -45, -25, -16, -17,   3,   0,  -5, -33,
    -36, -26, -12,  -1,   9,  -7,   6, -23,
    -24, -11,   7,  26,  24,  35,  -8, -20,
     -5,  19,  26,  36,  17,  45,  61,  16,
     27,  32,  58,  62,  80,  67,  26,  44,
     32,  42,  32,  51,  63,   9,  31,  43,
  ],
  [QUEEN]: [
     -1, -18,  -9,  10, -15, -25, -31, -50,
    -35,  -8,  11,   2,   8,  15,  -3,   1,
    -14,   2, -11,  -2,  -5,   2,  14,   5,
     -9, -26,  -9, -10,  -2,  -4,   3,  -3,
    -27, -27, -16, -16,  -1,  17,  -2,   1,
    -13, -17,   7,   8,  29,  56,  47,  57,
    -24, -39,  -5,   1, -16,  57,  28,  54,
    -28,   0,  29,  12,  59,  44,  43,  45,
  ],
  [KING]: [
    -15,  36,  12, -54,   8, -28,  24,  14,
      1,   7,  -8, -64, -43, -16,   9,   8,
    -14, -14, -22, -46, -44, -30, -15, -27,
    -49,  -1, -27, -39, -46, -44, -33, -51,
    -17, -20, -12, -27, -30, -25, -14, -36,
     -9,  24,   2, -16, -20,   6,  22, -22,
     29,  -1, -20,  -7,  -8,  -4, -38, -29,
    -65,  23,  16, -15, -56, -34,   2,  13,
  ],
};

const PST_EG = {
  [PAWN]: [
      0,   0,   0,   0,   0,   0,   0,   0,
     13,   8,   8,  10,  13,   0,   2,  -7,
      4,   7,  -6,   1,   0,  -5,  -1,  -8,
     13,   9,  -3,  -7,  -7,  -8,   3,  -1,
     32,  24,  13,   5,  -2,   4,  17,  17,
     94, 100,  85,  67,  56,  53,  82,  84,
    178, 173, 158, 134, 147, 132, 165, 187,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [KNIGHT]: [
    -29, -51, -23, -15, -22, -18, -50, -64,
    -42, -20, -10,  -5,  -2, -20, -23, -44,
    -23,  -3,  -1,  15,  10,  -3, -20, -22,
    -18,  -6,  16,  25,  16,  17,   4, -18,
    -17,   3,  22,  22,  22,  11,   8, -18,
    -24, -20,  10,   9,  -1,  -9, -19, -41,
    -25,  -8, -25,  -2,  -9, -25, -24, -52,
    -58, -38, -13, -28, -31, -27, -63, -99,
  ],
  [BISHOP]: [
    -23,  -9, -23,  -5,  -9, -16,  -5, -17,
    -14, -18,  -7,  -1,   4,  -9, -15, -27,
    -12,  -3,   8,  10,  13,   3,  -7, -15,
     -6,   3,  13,  19,   7,  10,  -3,  -9,
     -3,   9,  12,   9,  14,  10,   3,   2,
      2,  -8,   0,  -1,  -2,   6,   0,   4,
     -8,  -4,   7, -12,  -3, -13,  -4, -14,
    -14, -21, -11,  -8,  -7,  -9, -17, -24,
  ],
  [ROOK]: [
     -9,   2,   3,  -1,  -5, -13,   4, -20,
     -6,  -6,   0,   2,  -9,  -9, -11,  -3,
     -4,   0,  -5,  -1,  -7, -12,  -8, -16,
      3,   5,   8,   4,  -5,  -6,  -8, -11,
      4,   3,  13,   1,   2,   1,  -1,   2,
      7,   7,   7,   5,   4,  -3,  -5,  -3,
     11,  13,  13,  11,  -3,   3,   8,   3,
     13,  10,  18,  15,  12,  12,   8,   5,
  ],
  [QUEEN]: [
    -33, -28, -22, -43,  -5, -32, -20, -41,
    -22, -23, -30, -16, -16, -23, -36, -32,
    -16, -27,  15,   6,   9,  17,  10,   5,
    -18,  28,  19,  47,  31,  34,  39,  23,
      3,  22,  24,  45,  57,  40,  57,  36,
    -20,   6,   9,  49,  47,  35,  19,   9,
    -17,  20,  32,  41,  58,  25,  30,   0,
     -9,  22,  22,  27,  27,  19,  10,  20,
  ],
  [KING]: [
    -53, -34, -21, -11, -28, -14, -24, -43,
    -27, -11,   4,  13,  14,   4,  -5, -17,
    -19,  -3,  11,  21,  23,  16,   7,  -9,
    -18,  -4,  21,  24,  27,  23,   9, -11,
     -8,  22,  24,  27,  26,  33,  26,   3,
     10,  17,  23,  15,  20,  45,  44,  13,
    -12,  17,  14,  17,  17,  38,  23,  11,
    -74, -35, -18, -18, -11,  15,   4, -17,
  ],
};

// Flattened [pieceType][0x88 square] lookup per colour, built once.
const PST_MG_TABLE = [];
const PST_EG_TABLE = [];
(function buildPst() {
  for (let color = 0; color < 2; color++) {
    PST_MG_TABLE[color] = [];
    PST_EG_TABLE[color] = [];
    for (let type = PAWN; type <= KING; type++) {
      const mg = new Int16Array(128);
      const eg = new Int16Array(128);
      for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
          // Tables are written from White's view; mirror the rank for Black.
          const srcRank = color === WHITE ? rank : 7 - rank;
          const idx = srcRank * 8 + file;
          mg[sq0x88(file, rank)] = PST_MG[type][idx];
          eg[sq0x88(file, rank)] = PST_EG[type][idx];
        }
      }
      PST_MG_TABLE[color][type] = mg;
      PST_EG_TABLE[color][type] = eg;
    }
  }
})();

const PASSED_PAWN_MG = [0, 10, 17, 15, 62, 168, 276, 0];
const PASSED_PAWN_EG = [0, 28, 33, 41, 72, 177, 260, 0];

export const MATE_SCORE = 30000;
const MATE_THRESHOLD = MATE_SCORE - 1000;
const INFINITY_SCORE = 40000;

// ─── style profiles ─────────────────────────────────────────────────────────
// Every model plays the same rules with a different set of eyes. These weights
// are applied to the evaluation, so two personas genuinely disagree about which
// move is best rather than just narrating the same move differently.
export const DEFAULT_STYLE = {
  material: 1,        // greed
  kingAttack: 1,      // appetite for going after the enemy king
  mobility: 1,        // valuing active pieces
  pawnStructure: 1,   // caring about weaknesses
  kingSafety: 1,      // caring about its *own* king
  centre: 1,          // space and central control
  initiative: 0,      // flat bonus for having the move and open lines
  contempt: 0,        // negative = happy to draw, positive = plays on
};

export function makeStyle(overrides) {
  return { ...DEFAULT_STYLE, ...(overrides || {}) };
}

// ─── position ───────────────────────────────────────────────────────────────
export class Position {
  constructor() {
    this.board = new Int8Array(128);
    this.side = WHITE;
    this.castling = 0;
    this.epSquare = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = [-1, -1];
    this.key = 0;
    this.lock = 0;
    this.history = [];
    this.pathKeys = [];
  }

  static fromFen(fen) {
    const pos = new Position();
    pos.setFen(fen);
    return pos;
  }

  setFen(fen) {
    this.board.fill(EMPTY);
    const parts = String(fen).trim().split(/\s+/);
    const [placement, side = "w", castle = "-", ep = "-", half = "0", full = "1"] = parts;

    let rank = 7, file = 0;
    for (const ch of placement) {
      if (ch === "/") { rank--; file = 0; continue; }
      if (ch >= "1" && ch <= "8") { file += Number(ch); continue; }
      const lower = ch.toLowerCase();
      const type = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING }[lower];
      if (!type) continue;
      const color = ch === lower ? BLACK : WHITE;
      const sq = sq0x88(file, rank);
      this.board[sq] = pieceOf(type, color);
      if (type === KING) this.kings[color] = sq;
      file++;
    }

    this.side = side === "b" ? BLACK : WHITE;
    this.castling = 0;
    if (castle.includes("K")) this.castling |= CASTLE_WK;
    if (castle.includes("Q")) this.castling |= CASTLE_WQ;
    if (castle.includes("k")) this.castling |= CASTLE_BK;
    if (castle.includes("q")) this.castling |= CASTLE_BQ;
    this.epSquare = ep && ep !== "-" ? nameToSquare(ep) : -1;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.history.length = 0;
    this.pathKeys.length = 0;
    this.computeKey();
    return this;
  }

  computeKey() {
    let key = 0, lock = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.board[sq];
      if (p !== EMPTY) {
        key ^= ZOBRIST_PIECE[p * 128 + sq];
        lock ^= ZOBRIST_LOCK[p * 128 + sq];
      }
    }
    key ^= ZOBRIST_CASTLE[this.castling];
    lock ^= ZOBRIST_CASTLE_LOCK[this.castling];
    if (this.epSquare >= 0) { key ^= ZOBRIST_EP[this.epSquare]; lock ^= ZOBRIST_EP_LOCK[this.epSquare]; }
    if (this.side === BLACK) { key ^= ZOBRIST_SIDE; lock ^= ZOBRIST_SIDE_LOCK; }
    this.key = key >>> 0;
    this.lock = lock >>> 0;
  }

  // Is `sq` attacked by any piece of `bySide`?
  isAttacked(sq, bySide) {
    const board = this.board;

    // pawns
    const pawnDir = bySide === WHITE ? -16 : 16; // step back from sq toward the attacker
    const pawn = pieceOf(PAWN, bySide);
    let from = sq + pawnDir - 1;
    if (onBoard(from) && board[from] === pawn) return true;
    from = sq + pawnDir + 1;
    if (onBoard(from) && board[from] === pawn) return true;

    // knights
    const knight = pieceOf(KNIGHT, bySide);
    for (let i = 0; i < 8; i++) {
      const s = sq + KNIGHT_DELTAS[i];
      if (onBoard(s) && board[s] === knight) return true;
    }

    // king
    const king = pieceOf(KING, bySide);
    for (let i = 0; i < 8; i++) {
      const s = sq + KING_DELTAS[i];
      if (onBoard(s) && board[s] === king) return true;
    }

    // bishops / queens
    const bishop = pieceOf(BISHOP, bySide), queen = pieceOf(QUEEN, bySide);
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DELTAS[i];
      for (let s = sq + d; onBoard(s); s += d) {
        const p = board[s];
        if (p !== EMPTY) { if (p === bishop || p === queen) return true; break; }
      }
    }

    // rooks / queens
    const rook = pieceOf(ROOK, bySide);
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DELTAS[i];
      for (let s = sq + d; onBoard(s); s += d) {
        const p = board[s];
        if (p !== EMPTY) { if (p === rook || p === queen) return true; break; }
      }
    }

    return false;
  }

  inCheck(side = this.side) {
    const k = this.kings[side];
    return k >= 0 && this.isAttacked(k, side ^ 1);
  }

  // Pseudo-legal generation; legality is confirmed in makeMove.
  generateMoves(capturesOnly = false) {
    const moves = [];
    const board = this.board;
    const us = this.side, them = us ^ 1;

    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const piece = board[sq];
      if (piece === EMPTY || colorOf(piece) !== us) continue;
      const type = typeOf(piece);

      if (type === PAWN) {
        const dir = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6;
        const promoRank = us === WHITE ? 7 : 0;

        const one = sq + dir;
        if (!capturesOnly && onBoard(one) && board[one] === EMPTY) {
          if (rankOf(one) === promoRank) {
            for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
              moves.push(encodeMove(sq, one, 0, promo, FLAG_PROMO));
            }
          } else {
            moves.push(encodeMove(sq, one, 0, 0, 0));
            const two = sq + dir * 2;
            if (rankOf(sq) === startRank && board[two] === EMPTY) {
              moves.push(encodeMove(sq, two, 0, 0, FLAG_DOUBLE));
            }
          }
        }

        for (const side of [-1, 1]) {
          const to = sq + dir + side;
          if (!onBoard(to)) continue;
          const target = board[to];
          if (target !== EMPTY && colorOf(target) === them) {
            if (rankOf(to) === promoRank) {
              for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
                moves.push(encodeMove(sq, to, target, promo, FLAG_PROMO | FLAG_CAPTURE));
              }
            } else {
              moves.push(encodeMove(sq, to, target, 0, FLAG_CAPTURE));
            }
          } else if (target === EMPTY && to === this.epSquare) {
            moves.push(encodeMove(sq, to, pieceOf(PAWN, them), 0, FLAG_CAPTURE | FLAG_EP));
          }
        }
        continue;
      }

      if (type === KNIGHT || type === KING) {
        const deltas = type === KNIGHT ? KNIGHT_DELTAS : KING_DELTAS;
        for (let i = 0; i < 8; i++) {
          const to = sq + deltas[i];
          if (!onBoard(to)) continue;
          const target = board[to];
          if (target === EMPTY) {
            if (!capturesOnly) moves.push(encodeMove(sq, to, 0, 0, 0));
          } else if (colorOf(target) === them) {
            moves.push(encodeMove(sq, to, target, 0, FLAG_CAPTURE));
          }
        }
        continue;
      }

      // sliders
      const deltas = type === BISHOP ? BISHOP_DELTAS : type === ROOK ? ROOK_DELTAS : KING_DELTAS;
      const count = type === QUEEN ? 8 : 4;
      for (let i = 0; i < count; i++) {
        const d = deltas[i];
        for (let to = sq + d; onBoard(to); to += d) {
          const target = board[to];
          if (target === EMPTY) {
            if (!capturesOnly) moves.push(encodeMove(sq, to, 0, 0, 0));
            continue;
          }
          if (colorOf(target) === them) moves.push(encodeMove(sq, to, target, 0, FLAG_CAPTURE));
          break;
        }
      }
    }

    if (!capturesOnly) this.generateCastles(moves);
    return moves;
  }

  generateCastles(moves) {
    const us = this.side, them = us ^ 1;
    const board = this.board;
    if (us === WHITE) {
      if ((this.castling & CASTLE_WK) && board[0x05] === EMPTY && board[0x06] === EMPTY &&
          board[0x04] === pieceOf(KING, WHITE) && board[0x07] === pieceOf(ROOK, WHITE) &&
          !this.isAttacked(0x04, them) && !this.isAttacked(0x05, them) && !this.isAttacked(0x06, them)) {
        moves.push(encodeMove(0x04, 0x06, 0, 0, FLAG_CASTLE));
      }
      if ((this.castling & CASTLE_WQ) && board[0x03] === EMPTY && board[0x02] === EMPTY && board[0x01] === EMPTY &&
          board[0x04] === pieceOf(KING, WHITE) && board[0x00] === pieceOf(ROOK, WHITE) &&
          !this.isAttacked(0x04, them) && !this.isAttacked(0x03, them) && !this.isAttacked(0x02, them)) {
        moves.push(encodeMove(0x04, 0x02, 0, 0, FLAG_CASTLE));
      }
    } else {
      if ((this.castling & CASTLE_BK) && board[0x75] === EMPTY && board[0x76] === EMPTY &&
          board[0x74] === pieceOf(KING, BLACK) && board[0x77] === pieceOf(ROOK, BLACK) &&
          !this.isAttacked(0x74, them) && !this.isAttacked(0x75, them) && !this.isAttacked(0x76, them)) {
        moves.push(encodeMove(0x74, 0x76, 0, 0, FLAG_CASTLE));
      }
      if ((this.castling & CASTLE_BQ) && board[0x73] === EMPTY && board[0x72] === EMPTY && board[0x71] === EMPTY &&
          board[0x74] === pieceOf(KING, BLACK) && board[0x70] === pieceOf(ROOK, BLACK) &&
          !this.isAttacked(0x74, them) && !this.isAttacked(0x73, them) && !this.isAttacked(0x72, them)) {
        moves.push(encodeMove(0x74, 0x72, 0, 0, FLAG_CASTLE));
      }
    }
  }

  // Applies a pseudo-legal move; returns false (and reverts) if it left our own
  // king in check.
  makeMove(move) {
    const from = moveFrom(move), to = moveTo(move);
    const flags = moveFlags(move), promo = movePromo(move);
    const board = this.board;
    const piece = board[from];
    const us = colorOf(piece), them = us ^ 1;

    this.history.push({
      move,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      key: this.key,
      lock: this.lock,
      captured: moveCaptured(move),
    });
    this.pathKeys.push(this.key);

    let key = this.key, lock = this.lock;
    const xorPiece = (p, sq) => { key ^= ZOBRIST_PIECE[p * 128 + sq]; lock ^= ZOBRIST_LOCK[p * 128 + sq]; };

    key ^= ZOBRIST_CASTLE[this.castling]; lock ^= ZOBRIST_CASTLE_LOCK[this.castling];
    if (this.epSquare >= 0) { key ^= ZOBRIST_EP[this.epSquare]; lock ^= ZOBRIST_EP_LOCK[this.epSquare]; }

    // remove captured piece
    if (flags & FLAG_EP) {
      const capSq = to + (us === WHITE ? -16 : 16);
      xorPiece(board[capSq], capSq);
      board[capSq] = EMPTY;
    } else if (flags & FLAG_CAPTURE) {
      xorPiece(board[to], to);
    }

    // move the piece
    xorPiece(piece, from);
    board[from] = EMPTY;
    const placed = (flags & FLAG_PROMO) ? pieceOf(promo, us) : piece;
    board[to] = placed;
    xorPiece(placed, to);

    if (typeOf(piece) === KING) this.kings[us] = to;

    // rook hop on castling
    if (flags & FLAG_CASTLE) {
      const kingSide = fileOf(to) === 6;
      const rookFrom = kingSide ? to + 1 : to - 2;
      const rookTo = kingSide ? to - 1 : to + 1;
      const rook = board[rookFrom];
      xorPiece(rook, rookFrom);
      board[rookFrom] = EMPTY;
      board[rookTo] = rook;
      xorPiece(rook, rookTo);
    }

    // castling rights
    if (typeOf(piece) === KING) {
      this.castling &= us === WHITE ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ);
    }
    if (from === 0x00 || to === 0x00) this.castling &= ~CASTLE_WQ;
    if (from === 0x07 || to === 0x07) this.castling &= ~CASTLE_WK;
    if (from === 0x70 || to === 0x70) this.castling &= ~CASTLE_BQ;
    if (from === 0x77 || to === 0x77) this.castling &= ~CASTLE_BK;

    this.epSquare = (flags & FLAG_DOUBLE) ? from + (us === WHITE ? 16 : -16) : -1;

    key ^= ZOBRIST_CASTLE[this.castling]; lock ^= ZOBRIST_CASTLE_LOCK[this.castling];
    if (this.epSquare >= 0) { key ^= ZOBRIST_EP[this.epSquare]; lock ^= ZOBRIST_EP_LOCK[this.epSquare]; }
    key ^= ZOBRIST_SIDE; lock ^= ZOBRIST_SIDE_LOCK;

    this.halfmove = (typeOf(piece) === PAWN || (flags & FLAG_CAPTURE)) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = them;
    this.key = key >>> 0;
    this.lock = lock >>> 0;

    if (this.isAttacked(this.kings[us], them)) {
      this.unmakeMove();
      return false;
    }
    return true;
  }

  unmakeMove() {
    const entry = this.history.pop();
    if (!entry) return;
    this.pathKeys.pop();

    const { move, castling, epSquare, halfmove, key, lock, captured } = entry;
    const from = moveFrom(move), to = moveTo(move);
    const flags = moveFlags(move);
    const board = this.board;
    const them = this.side;
    const us = them ^ 1;

    const placed = board[to];
    // Undo promotion by restoring a pawn.
    const original = (flags & FLAG_PROMO) ? pieceOf(PAWN, us) : placed;
    board[from] = original;
    board[to] = EMPTY;

    if (typeOf(original) === KING) this.kings[us] = from;

    if (flags & FLAG_EP) {
      const capSq = to + (us === WHITE ? -16 : 16);
      board[capSq] = captured;
    } else if (flags & FLAG_CAPTURE) {
      board[to] = captured;
    }

    if (flags & FLAG_CASTLE) {
      const kingSide = fileOf(to) === 6;
      const rookFrom = kingSide ? to + 1 : to - 2;
      const rookTo = kingSide ? to - 1 : to + 1;
      board[rookFrom] = board[rookTo];
      board[rookTo] = EMPTY;
    }

    this.castling = castling;
    this.epSquare = epSquare;
    this.halfmove = halfmove;
    this.key = key;
    this.lock = lock;
    if (us === BLACK) this.fullmove--;
    this.side = us;
  }

  // Null move: hand the turn over without playing anything.
  makeNullMove() {
    this.history.push({
      move: 0, castling: this.castling, epSquare: this.epSquare,
      halfmove: this.halfmove, key: this.key, lock: this.lock, captured: 0, isNull: true,
    });
    this.pathKeys.push(this.key);
    let key = this.key, lock = this.lock;
    if (this.epSquare >= 0) { key ^= ZOBRIST_EP[this.epSquare]; lock ^= ZOBRIST_EP_LOCK[this.epSquare]; }
    key ^= ZOBRIST_SIDE; lock ^= ZOBRIST_SIDE_LOCK;
    this.epSquare = -1;
    this.side ^= 1;
    this.key = key >>> 0;
    this.lock = lock >>> 0;
  }

  unmakeNullMove() {
    const entry = this.history.pop();
    if (!entry) return;
    this.pathKeys.pop();
    this.castling = entry.castling;
    this.epSquare = entry.epSquare;
    this.halfmove = entry.halfmove;
    this.key = entry.key;
    this.lock = entry.lock;
    this.side ^= 1;
  }

  legalMoves() {
    const out = [];
    for (const move of this.generateMoves(false)) {
      if (this.makeMove(move)) { out.push(move); this.unmakeMove(); }
    }
    return out;
  }

  // Long algebraic ("e2e4", "e7e8q") — unambiguous, and what the arena uses to
  // hand a move back to chess.js.
  moveToUci(move) {
    const promo = movePromo(move);
    return squareName(moveFrom(move)) + squareName(moveTo(move)) +
      (promo ? { [QUEEN]: "q", [ROOK]: "r", [BISHOP]: "b", [KNIGHT]: "n" }[promo] : "");
  }

  findMoveByUci(uci) {
    if (!uci) return 0;
    const want = String(uci).trim().toLowerCase();
    for (const move of this.legalMoves()) {
      if (this.moveToUci(move) === want) return move;
    }
    return 0;
  }

  pieceCounts() {
    const counts = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.board[sq];
      if (p !== EMPTY) counts[colorOf(p)][typeOf(p)]++;
    }
    return counts;
  }

  phase() {
    let phase = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.board[sq];
      if (p !== EMPTY) phase += PHASE_WEIGHT[typeOf(p)];
    }
    return Math.min(phase, TOTAL_PHASE);
  }

  isRepetition() {
    // Two prior occurrences of the current key in the search path.
    let count = 0;
    for (let i = this.pathKeys.length - 1; i >= 0; i--) {
      if (this.pathKeys[i] === this.key) { count++; if (count >= 1) return true; }
    }
    return false;
  }
}

// ─── evaluation ─────────────────────────────────────────────────────────────
const FILE_MASK_CACHE = new Int8Array(8);

function evaluate(pos, style) {
  const board = pos.board;
  let mgScore = 0, egScore = 0;
  let material = [0, 0];
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  const pawnRanks = [[], []];
  let bishops = [0, 0];
  let mobility = [0, 0];
  let kingAttack = [0, 0];

  const kingSq = pos.kings;

  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    const piece = board[sq];
    if (piece === EMPTY) continue;
    const color = colorOf(piece), type = typeOf(piece);
    const sign = color === WHITE ? 1 : -1;

    material[color] += SIMPLE_VALUE[type];
    mgScore += sign * (MG_VALUE[type] + PST_MG_TABLE[color][type][sq]);
    egScore += sign * (EG_VALUE[type] + PST_EG_TABLE[color][type][sq]);

    if (type === PAWN) {
      pawnFiles[color][fileOf(sq)]++;
      pawnRanks[color].push(sq);
    } else if (type === BISHOP) {
      bishops[color]++;
    }

    // Cheap mobility + king-zone pressure for the pieces where it matters.
    if (type === KNIGHT || type === BISHOP || type === ROOK || type === QUEEN) {
      const enemyKing = kingSq[color ^ 1];
      let moves = 0, attacks = 0;
      if (type === KNIGHT) {
        for (let i = 0; i < 8; i++) {
          const to = sq + KNIGHT_DELTAS[i];
          if (!onBoard(to)) continue;
          const t = board[to];
          if (t === EMPTY || colorOf(t) !== color) moves++;
          if (enemyKing >= 0 && isNear(to, enemyKing)) attacks++;
        }
      } else {
        const deltas = type === BISHOP ? BISHOP_DELTAS : type === ROOK ? ROOK_DELTAS : KING_DELTAS;
        const count = type === QUEEN ? 8 : 4;
        for (let i = 0; i < count; i++) {
          const d = deltas[i];
          for (let to = sq + d; onBoard(to); to += d) {
            const t = board[to];
            if (t === EMPTY || colorOf(t) !== color) moves++;
            if (enemyKing >= 0 && isNear(to, enemyKing)) attacks++;
            if (t !== EMPTY) break;
          }
        }
      }
      mobility[color] += moves;
      kingAttack[color] += attacks * (type === QUEEN ? 4 : type === ROOK ? 2 : 1);
    }

    // Rooks like open and half-open files.
    if (type === ROOK) {
      const f = fileOf(sq);
      let own = 0, enemy = 0;
      for (let r = 0; r < 8; r++) {
        const p = board[sq0x88(f, r)];
        if (p === EMPTY || typeOf(p) !== PAWN) continue;
        if (colorOf(p) === color) own++; else enemy++;
      }
      if (own === 0 && enemy === 0) { mgScore += sign * 26; egScore += sign * 12; }
      else if (own === 0) { mgScore += sign * 13; egScore += sign * 6; }
    }
  }

  // Pawn structure
  for (let color = 0; color < 2; color++) {
    const sign = color === WHITE ? 1 : -1;
    const them = color ^ 1;
    let structure = 0;
    for (let f = 0; f < 8; f++) {
      const count = pawnFiles[color][f];
      if (count > 1) structure -= 16 * (count - 1);                 // doubled
      if (count > 0) {
        const left = f > 0 ? pawnFiles[color][f - 1] : 0;
        const right = f < 7 ? pawnFiles[color][f + 1] : 0;
        if (left === 0 && right === 0) structure -= 18;             // isolated
      }
    }
    mgScore += sign * structure * style.pawnStructure;
    egScore += sign * structure * style.pawnStructure;

    // Passed pawns — the main endgame currency.
    for (const sq of pawnRanks[color]) {
      const f = fileOf(sq);
      const r = rankOf(sq);
      let blocked = false;
      for (let df = -1; df <= 1 && !blocked; df++) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const start = color === WHITE ? r + 1 : 0;
        const end = color === WHITE ? 7 : r - 1;
        for (let nr = start; nr <= end; nr++) {
          const p = board[sq0x88(nf, nr)];
          if (p !== EMPTY && typeOf(p) === PAWN && colorOf(p) === them) { blocked = true; break; }
        }
      }
      if (!blocked) {
        const advanced = color === WHITE ? r : 7 - r;
        mgScore += sign * PASSED_PAWN_MG[advanced];
        egScore += sign * PASSED_PAWN_EG[advanced];
      }
    }

    if (bishops[color] >= 2) { mgScore += sign * 28; egScore += sign * 46; }

    // King safety: reward a pawn shield in front of a castled king.
    const k = kingSq[color];
    if (k >= 0) {
      let shield = 0;
      const dir = color === WHITE ? 16 : -16;
      for (let df = -1; df <= 1; df++) {
        const s = k + dir + df;
        if (onBoard(s) && board[s] !== EMPTY && typeOf(board[s]) === PAWN && colorOf(board[s]) === color) shield += 12;
      }
      mgScore += sign * shield * style.kingSafety;
    }
  }

  // Keeping the right to castle is worth real midgame points. Without this the
  // rook's piece-square table makes Rh1-f1 look like a gain — it collects the
  // "rook belongs on f1" bonus while quietly throwing away kingside castling.
  const rights = (mask) => ((pos.castling & mask) ? 1 : 0);
  const castleRights = (rights(CASTLE_WK) + rights(CASTLE_WQ)) - (rights(CASTLE_BK) + rights(CASTLE_BQ));
  mgScore += castleRights * 18 * style.kingSafety;

  const mobilityTerm = (mobility[WHITE] - mobility[BLACK]) * 2;
  mgScore += mobilityTerm * style.mobility;
  egScore += mobilityTerm * style.mobility;

  const attackTerm = (kingAttack[WHITE] - kingAttack[BLACK]) * 3;
  mgScore += attackTerm * style.kingAttack;

  // Greed dial: scale the raw material difference on top of the base eval.
  const materialTerm = (material[WHITE] - material[BLACK]) * (style.material - 1);
  mgScore += materialTerm;
  egScore += materialTerm;

  const phase = pos.phase();
  let score = Math.round((mgScore * phase + egScore * (TOTAL_PHASE - phase)) / TOTAL_PHASE);

  // Side-to-move bonus; "initiative" personas value it more.
  const tempo = 12 + style.initiative * 10;
  score += pos.side === WHITE ? tempo : -tempo;

  return pos.side === WHITE ? score : -score;
}

function isNear(a, b) {
  const df = Math.abs(fileOf(a) - fileOf(b));
  const dr = Math.abs(rankOf(a) - rankOf(b));
  return df <= 1 && dr <= 1;
}

// ─── static exchange evaluation (is this capture actually safe?) ────────────
function seeCapture(pos, move) {
  const to = moveTo(move);
  const captured = moveCaptured(move);
  const attacker = pos.board[moveFrom(move)];
  const gain = SIMPLE_VALUE[typeOf(captured)] - SIMPLE_VALUE[typeOf(attacker)];
  // Winning or equal trades are fine on the face of it; for losing-looking
  // ones, check whether the destination is actually defended.
  if (gain >= 0) return gain;
  if (!pos.makeMove(move)) return -INFINITY_SCORE;
  const defended = pos.isAttacked(to, pos.side);
  pos.unmakeMove();
  return defended ? gain : SIMPLE_VALUE[typeOf(captured)];
}

// ─── transposition table ────────────────────────────────────────────────────
const TT_SIZE = 1 << 17;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

class TranspositionTable {
  constructor() {
    this.keys = new Uint32Array(TT_SIZE);
    this.locks = new Uint32Array(TT_SIZE);
    this.moves = new Int32Array(TT_SIZE);
    this.scores = new Int32Array(TT_SIZE);
    this.depths = new Int8Array(TT_SIZE);
    this.flags = new Uint8Array(TT_SIZE);
    this.used = new Uint8Array(TT_SIZE);
  }
  clear() { this.used.fill(0); }
  probe(key, lock) {
    const i = key & TT_MASK;
    if (!this.used[i] || this.keys[i] !== key || this.locks[i] !== lock) return null;
    return { move: this.moves[i], score: this.scores[i], depth: this.depths[i], flag: this.flags[i] };
  }
  store(key, lock, move, score, depth, flag) {
    const i = key & TT_MASK;
    // Depth-preferred replacement, but always overwrite a different position.
    if (this.used[i] && this.keys[i] === key && this.locks[i] === lock && this.depths[i] > depth) return;
    this.keys[i] = key; this.locks[i] = lock;
    this.moves[i] = move; this.scores[i] = score;
    this.depths[i] = depth; this.flags[i] = flag;
    this.used[i] = 1;
  }
}

// ─── search ─────────────────────────────────────────────────────────────────
const MAX_PLY = 64;

export class Engine {
  constructor() {
    this.tt = new TranspositionTable();
    this.killers = new Int32Array(MAX_PLY * 2);
    this.history = new Int32Array(16 * 128);
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
  }

  reset() {
    this.tt.clear();
    this.killers.fill(0);
    this.history.fill(0);
  }

  outOfTime() {
    if (this.aborted) return true;
    // Checking the clock is not free, so only look every 1024 nodes.
    if ((this.nodes & 1023) === 0 && Date.now() >= this.deadline) this.aborted = true;
    return this.aborted;
  }

  scoreMove(pos, move, ply, ttMove) {
    if (move === ttMove) return 1_000_000;
    const flags = moveFlags(move);
    if (flags & FLAG_PROMO) return 900_000 + SIMPLE_VALUE[movePromo(move)];
    if (flags & FLAG_CAPTURE) {
      // MVV-LVA: grab the fattest victim with the cheapest attacker.
      const victim = SIMPLE_VALUE[typeOf(moveCaptured(move))];
      const attacker = SIMPLE_VALUE[typeOf(pos.board[moveFrom(move)])];
      return 800_000 + victim * 16 - attacker;
    }
    if (this.killers[ply * 2] === move) return 700_000;
    if (this.killers[ply * 2 + 1] === move) return 690_000;
    const piece = pos.board[moveFrom(move)];
    return this.history[piece * 128 + moveTo(move)];
  }

  orderMoves(pos, moves, ply, ttMove) {
    const scored = moves.map((m) => ({ m, s: this.scoreMove(pos, m, ply, ttMove) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  }

  quiescence(pos, alpha, beta, style, ply) {
    this.nodes++;
    if (this.outOfTime()) return alpha;
    if (ply >= MAX_PLY - 1) return evaluate(pos, style);

    const standPat = evaluate(pos, style);
    if (standPat >= beta) return beta;
    // Delta pruning: even winning a queen wouldn't rescue this node.
    if (standPat + 1000 < alpha) return alpha;
    if (standPat > alpha) alpha = standPat;

    const moves = this.orderMoves(pos, pos.generateMoves(true), ply, 0);
    for (const move of moves) {
      // Skip captures that lose material outright.
      if (!(moveFlags(move) & FLAG_PROMO) && seeCapture(pos, move) < -50) continue;
      if (!pos.makeMove(move)) continue;
      const score = -this.quiescence(pos, -beta, -alpha, style, ply + 1);
      pos.unmakeMove();
      if (this.aborted) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  search(pos, depth, alpha, beta, style, ply, allowNull = true) {
    if (this.outOfTime()) return alpha;
    this.nodes++;

    if (ply > 0 && (pos.isRepetition() || pos.halfmove >= 100)) {
      return -style.contempt * 20;
    }
    if (ply >= MAX_PLY - 1) return evaluate(pos, style);

    const inCheck = pos.inCheck();
    if (inCheck) depth++; // check extension — never stop calculating mid-forcing-line

    if (depth <= 0) return this.quiescence(pos, alpha, beta, style, ply);

    const alphaOrig = alpha;
    let ttMove = 0;
    const entry = this.tt.probe(pos.key, pos.lock);
    if (entry) {
      ttMove = entry.move;
      if (ply > 0 && entry.depth >= depth) {
        if (entry.flag === TT_EXACT) return entry.score;
        if (entry.flag === TT_LOWER && entry.score > alpha) alpha = entry.score;
        else if (entry.flag === TT_UPPER && entry.score < beta) beta = entry.score;
        if (alpha >= beta) return entry.score;
      }
    }

    // Null-move pruning. Skipped in check, in shallow nodes, and in likely
    // zugzwang (a side with only pawns left).
    if (allowNull && !inCheck && depth >= 3 && ply > 0 && hasNonPawnMaterial(pos, pos.side)) {
      const staticEval = evaluate(pos, style);
      if (staticEval >= beta) {
        const R = 2 + (depth > 6 ? 1 : 0);
        pos.makeNullMove();
        const score = -this.search(pos, depth - 1 - R, -beta, -beta + 1, style, ply + 1, false);
        pos.unmakeNullMove();
        if (this.aborted) return alpha;
        if (score >= beta && Math.abs(score) < MATE_THRESHOLD) return beta;
      }
    }

    const pseudo = this.orderMoves(pos, pos.generateMoves(false), ply, ttMove);
    let best = -INFINITY_SCORE;
    let bestMove = 0;
    let legal = 0;

    for (let i = 0; i < pseudo.length; i++) {
      const move = pseudo[i];
      if (!pos.makeMove(move)) continue;
      legal++;

      const isQuiet = !(moveFlags(move) & (FLAG_CAPTURE | FLAG_PROMO));
      let score;
      if (legal === 1) {
        score = -this.search(pos, depth - 1, -beta, -alpha, style, ply + 1);
      } else {
        // Late move reductions: trust the ordering and look at the tail shallowly.
        let reduction = 0;
        if (depth >= 3 && legal > 3 && isQuiet && !inCheck) {
          reduction = legal > 6 ? 2 : 1;
        }
        score = -this.search(pos, depth - 1 - reduction, -alpha - 1, -alpha, style, ply + 1);
        if (score > alpha && reduction > 0) {
          score = -this.search(pos, depth - 1, -alpha - 1, -alpha, style, ply + 1);
        }
        if (score > alpha && score < beta) {
          score = -this.search(pos, depth - 1, -beta, -alpha, style, ply + 1);
        }
      }
      pos.unmakeMove();
      if (this.aborted) return best > -INFINITY_SCORE ? best : alpha;

      if (score > best) {
        best = score;
        bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (isQuiet) {
              this.killers[ply * 2 + 1] = this.killers[ply * 2];
              this.killers[ply * 2] = move;
              const piece = pos.board[moveFrom(move)];
              this.history[piece * 128 + moveTo(move)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legal === 0) {
      // Mate scores are ply-adjusted so a faster mate is preferred.
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    this.tt.store(pos.key, pos.lock, bestMove, best, depth, flag);
    return best;
  }

  // Iterative deepening from the root, returning ranked candidate moves.
  analyse(pos, { maxDepth = 64, timeMs = 700, style = DEFAULT_STYLE, multiPv = 4 } = {}) {
    this.nodes = 0;
    this.aborted = false;
    this.deadline = Date.now() + Math.max(30, timeMs);
    this.killers.fill(0);

    const rootMoves = pos.legalMoves();
    if (!rootMoves.length) {
      return { best: 0, score: pos.inCheck() ? -MATE_SCORE : 0, depth: 0, nodes: 0, lines: [] };
    }

    let ordered = this.orderMoves(pos, rootMoves, 0, 0);
    let bestMove = ordered[0];
    let bestScore = 0;
    let completedDepth = 0;
    let lines = [];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const scores = [];
      let iterationBest = 0;
      let iterationScore = -INFINITY_SCORE;

      for (let i = 0; i < ordered.length; i++) {
        const move = ordered[i];
        if (!pos.makeMove(move)) continue;
        // Every root move gets a full window. Narrowing alpha here would make
        // the also-rans return a bound rather than a real score, and the
        // candidate list handed to the models has to carry true evaluations —
        // it is what they reason over, and what the blunder check compares
        // against. One ply of depth is a fair price for honest numbers.
        const score = -this.search(pos, depth - 1, -INFINITY_SCORE, INFINITY_SCORE, style, 1);
        pos.unmakeMove();
        if (this.aborted) break;
        scores.push({ move, score });
        if (score > iterationScore) { iterationScore = score; iterationBest = move; }
      }

      if (this.aborted && completedDepth > 0) break;
      if (!scores.length) break;

      scores.sort((a, b) => b.score - a.score);
      ordered = scores.map((s) => s.move);
      bestMove = iterationBest || bestMove;
      bestScore = iterationScore;
      completedDepth = depth;
      lines = scores.slice(0, multiPv).map((s) => ({ move: s.move, score: s.score }));

      if (this.aborted) break;
      if (Math.abs(bestScore) > MATE_THRESHOLD) break; // forced mate found
      if (Date.now() >= this.deadline) break;
    }

    return { best: bestMove, score: bestScore, depth: completedDepth, nodes: this.nodes, lines };
  }
}

function hasNonPawnMaterial(pos, side) {
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p === EMPTY || colorOf(p) !== side) continue;
    const t = typeOf(p);
    if (t !== PAWN && t !== KING) return true;
  }
  return false;
}

// ─── shared instance + convenience helpers ──────────────────────────────────
const sharedEngine = new Engine();

export function analysePosition(fen, options = {}) {
  const pos = Position.fromFen(fen);
  const result = sharedEngine.analyse(pos, options);
  return {
    ...result,
    bestUci: result.best ? pos.moveToUci(result.best) : null,
    lines: result.lines.map((l) => ({ uci: pos.moveToUci(l.move), score: l.score })),
  };
}

// Score of a specific move, from the mover's point of view.
export function evaluateMove(fen, uci, options = {}) {
  const pos = Position.fromFen(fen);
  const move = pos.findMoveByUci(uci);
  if (!move) return null;
  const { timeMs = 300, maxDepth = 64, style = DEFAULT_STYLE } = options;
  pos.makeMove(move);
  sharedEngine.nodes = 0;
  sharedEngine.aborted = false;
  sharedEngine.deadline = Date.now() + Math.max(30, timeMs);
  // Negated: the search runs from the opponent's side after our move.
  const score = -sharedEngine.search(pos, Math.max(1, maxDepth), -INFINITY_SCORE, INFINITY_SCORE, style, 1);
  pos.unmakeMove();
  return score;
}

export { squareName, nameToSquare, typeOf, colorOf, onBoard, fileOf, rankOf, sq0x88, moveFrom, moveTo, moveCaptured, movePromo, moveFlags, FLAG_CAPTURE, FLAG_PROMO, FLAG_CASTLE, FLAG_EP };
