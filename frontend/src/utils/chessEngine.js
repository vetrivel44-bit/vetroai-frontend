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
// Scratch buffers reused by every call: evaluate() runs at every leaf, and
// allocating fresh arrays there was a large share of the search time.
const EV_PAWN_FILES = [new Int8Array(8), new Int8Array(8)];
// Most and least advanced pawn rank per file, for the passed-pawn test.
const EV_PAWN_MAX_RANK = [new Int8Array(8), new Int8Array(8)];
const EV_PAWN_MIN_RANK = [new Int8Array(8), new Int8Array(8)];
const EV_PAWN_SQS = [new Int16Array(16), new Int16Array(16)];
const EV_PAWN_COUNT = new Int8Array(2);

function evaluate(pos, style) {
  const board = pos.board;
  let mgScore = 0, egScore = 0;
  let materialW = 0, materialB = 0;
  let bishopsW = 0, bishopsB = 0;
  let mobilityW = 0, mobilityB = 0;
  let attackW = 0, attackB = 0;
  let phase = 0;

  for (let c = 0; c < 2; c++) {
    EV_PAWN_FILES[c].fill(0);
    EV_PAWN_MAX_RANK[c].fill(-1);
    EV_PAWN_MIN_RANK[c].fill(8);
    EV_PAWN_COUNT[c] = 0;
  }

  const kingSq = pos.kings;

  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) { sq += 7; continue; }
    const piece = board[sq];
    if (piece === EMPTY) continue;
    const color = colorOf(piece), type = typeOf(piece);
    const sign = color === WHITE ? 1 : -1;

    if (color === WHITE) materialW += SIMPLE_VALUE[type]; else materialB += SIMPLE_VALUE[type];
    phase += PHASE_WEIGHT[type];
    mgScore += sign * (MG_VALUE[type] + PST_MG_TABLE[color][type][sq]);
    egScore += sign * (EG_VALUE[type] + PST_EG_TABLE[color][type][sq]);

    if (type === PAWN) {
      const f = fileOf(sq), r = rankOf(sq);
      EV_PAWN_FILES[color][f]++;
      if (r > EV_PAWN_MAX_RANK[color][f]) EV_PAWN_MAX_RANK[color][f] = r;
      if (r < EV_PAWN_MIN_RANK[color][f]) EV_PAWN_MIN_RANK[color][f] = r;
      if (EV_PAWN_COUNT[color] < 16) EV_PAWN_SQS[color][EV_PAWN_COUNT[color]++] = sq;
      continue;
    }
    if (type === KING) continue;
    if (type === BISHOP) { if (color === WHITE) bishopsW++; else bishopsB++; }

    // Mobility + king-zone pressure.
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
    // A queen's raw square count dwarfs everything else; damp it.
    if (type === QUEEN) moves >>= 1;
    const weight = type === QUEEN ? 4 : type === ROOK ? 2 : 1;
    if (color === WHITE) { mobilityW += moves; attackW += attacks * weight; }
    else { mobilityB += moves; attackB += attacks * weight; }

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
    const files = EV_PAWN_FILES[color];
    let structure = 0;
    for (let f = 0; f < 8; f++) {
      const count = files[f];
      if (count > 1) structure -= 16 * (count - 1);                 // doubled
      if (count > 0) {
        const left = f > 0 ? files[f - 1] : 0;
        const right = f < 7 ? files[f + 1] : 0;
        if (left === 0 && right === 0) structure -= 18;             // isolated
      }
    }
    mgScore += sign * structure * style.pawnStructure;
    egScore += sign * structure * style.pawnStructure;

    // Passed pawns — the main endgame currency. A White pawn is passed when no
    // Black pawn on its own or a neighbouring file stands further up the board.
    const sqs = EV_PAWN_SQS[color];
    for (let i = 0; i < EV_PAWN_COUNT[color]; i++) {
      const sq = sqs[i];
      const f = fileOf(sq), r = rankOf(sq);
      let blocked = false;
      for (let nf = Math.max(0, f - 1); nf <= Math.min(7, f + 1); nf++) {
        if (color === WHITE ? EV_PAWN_MAX_RANK[them][nf] > r : EV_PAWN_MIN_RANK[them][nf] < r) { blocked = true; break; }
      }
      if (!blocked) {
        const advanced = color === WHITE ? r : 7 - r;
        mgScore += sign * PASSED_PAWN_MG[advanced];
        egScore += sign * PASSED_PAWN_EG[advanced];
      }
    }

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

  if (bishopsW >= 2) { mgScore += 28; egScore += 46; }
  if (bishopsB >= 2) { mgScore -= 28; egScore -= 46; }

  // Keeping the right to castle is worth real midgame points. Without this the
  // rook's piece-square table makes Rh1-f1 look like a gain — it collects the
  // "rook belongs on f1" bonus while quietly throwing away kingside castling.
  const rights = (mask) => ((pos.castling & mask) ? 1 : 0);
  const castleRights = (rights(CASTLE_WK) + rights(CASTLE_WQ)) - (rights(CASTLE_BK) + rights(CASTLE_BQ));
  mgScore += castleRights * 18 * style.kingSafety;

  const mobilityTerm = (mobilityW - mobilityB) * 3;
  mgScore += mobilityTerm * style.mobility;
  egScore += mobilityTerm * style.mobility;

  // Pressure on the king grows faster than linearly: three pieces aimed at it
  // are far more than three times as dangerous as one.
  const attackTerm = (attackW * (4 + Math.min(attackW, 12)) - attackB * (4 + Math.min(attackB, 12))) >> 1;
  mgScore += attackTerm * style.kingAttack;

  // Greed dial: scale the raw material difference on top of the base eval.
  const materialTerm = (materialW - materialB) * (style.material - 1);
  mgScore += materialTerm;
  egScore += materialTerm;

  if (phase > TOTAL_PHASE) phase = TOTAL_PHASE;
  let score = Math.round((mgScore * phase + egScore * (TOTAL_PHASE - phase)) / TOTAL_PHASE);

  // Without pawns, a lone minor piece up cannot win: pull such scores to zero
  // so the search doesn't trade into "won" endgames that are dead draws.
  if (score > 0 && EV_PAWN_COUNT[WHITE] === 0 && materialW - materialB <= SIMPLE_VALUE[BISHOP] + 20) score >>= 2;
  if (score < 0 && EV_PAWN_COUNT[BLACK] === 0 && materialB - materialW <= SIMPLE_VALUE[BISHOP] + 20) score = -((-score) >> 2);

  // Mop-up: with a decisive material edge in an endgame, drive the losing
  // king to the edge and bring our own king close — otherwise the search can
  // shuffle for fifty moves in a "won" position without ever mating.
  const edge = materialW - materialB;
  if (phase <= 8 && Math.abs(edge) >= 400 && kingSq[WHITE] >= 0 && kingSq[BLACK] >= 0) {
    const winner = edge > 0 ? WHITE : BLACK;
    const loserKing = kingSq[winner ^ 1], winnerKing = kingSq[winner];
    const centre = Math.max(3 - fileOf(loserKing), fileOf(loserKing) - 4) + Math.max(3 - rankOf(loserKing), rankOf(loserKing) - 4);
    const distance = Math.abs(fileOf(loserKing) - fileOf(winnerKing)) + Math.abs(rankOf(loserKing) - rankOf(winnerKing));
    const mopUp = centre * 12 + (14 - distance) * 5;
    score += winner === WHITE ? mopUp : -mopUp;
  }

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

// ─── static exchange evaluation ─────────────────────────────────────────────
// Plays out every capture on one square, cheapest attacker first, and returns
// what the first capture really wins. Pieces are lifted off the board as they
// capture, so batteries and x-rays behind them join in naturally.
function leastValuableAttacker(board, sq, side) {
  const pawn = pieceOf(PAWN, side);
  const back = side === WHITE ? -16 : 16;
  let s = sq + back - 1;
  if (onBoard(s) && board[s] === pawn) return s;
  s = sq + back + 1;
  if (onBoard(s) && board[s] === pawn) return s;

  const knight = pieceOf(KNIGHT, side);
  for (let i = 0; i < 8; i++) {
    s = sq + KNIGHT_DELTAS[i];
    if (onBoard(s) && board[s] === knight) return s;
  }

  const bishop = pieceOf(BISHOP, side), rook = pieceOf(ROOK, side), queen = pieceOf(QUEEN, side);
  let bestSq = -1, bestValue = INFINITY_SCORE;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_DELTAS[i];
    for (s = sq + d; onBoard(s); s += d) {
      const p = board[s];
      if (p === EMPTY) continue;
      if (p === bishop) return s; // nothing cheaper is left to find
      if (p === queen && SIMPLE_VALUE[QUEEN] < bestValue) { bestSq = s; bestValue = SIMPLE_VALUE[QUEEN]; }
      break;
    }
  }
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DELTAS[i];
    for (s = sq + d; onBoard(s); s += d) {
      const p = board[s];
      if (p === EMPTY) continue;
      if (p === rook && SIMPLE_VALUE[ROOK] < bestValue) { bestSq = s; bestValue = SIMPLE_VALUE[ROOK]; }
      else if (p === queen && SIMPLE_VALUE[QUEEN] < bestValue) { bestSq = s; bestValue = SIMPLE_VALUE[QUEEN]; }
      break;
    }
  }
  if (bestSq >= 0) return bestSq;

  const king = pieceOf(KING, side);
  for (let i = 0; i < 8; i++) {
    s = sq + KING_DELTAS[i];
    if (onBoard(s) && board[s] === king) return s;
  }
  return -1;
}

const SEE_GAIN = new Int32Array(40);
const SEE_SQS = new Int16Array(40);
const SEE_PIECES = new Int8Array(40);

export function see(pos, move) {
  const board = pos.board;
  const from = moveFrom(move), to = moveTo(move), flags = moveFlags(move);
  const captured = moveCaptured(move);
  let lifted = 0;
  const lift = (sq) => { SEE_SQS[lifted] = sq; SEE_PIECES[lifted] = board[sq]; lifted++; board[sq] = EMPTY; };

  const mover = board[from];
  let side = colorOf(mover) ^ 1;
  let d = 0;
  SEE_GAIN[0] = captured ? SIMPLE_VALUE[typeOf(captured)] : 0;
  let onSquare = SIMPLE_VALUE[typeOf(mover)];
  if (flags & FLAG_PROMO) {
    SEE_GAIN[0] += SIMPLE_VALUE[movePromo(move)] - SIMPLE_VALUE[PAWN];
    onSquare = SIMPLE_VALUE[movePromo(move)];
  }
  lift(from);
  if (flags & FLAG_EP) lift(to + (colorOf(mover) === WHITE ? -16 : 16));

  while (d < 38) {
    d++;
    SEE_GAIN[d] = onSquare - SEE_GAIN[d - 1];
    if (Math.max(-SEE_GAIN[d - 1], SEE_GAIN[d]) < 0) break;
    const sq = leastValuableAttacker(board, to, side);
    if (sq < 0) break;
    onSquare = SIMPLE_VALUE[typeOf(board[sq])];
    lift(sq);
    side ^= 1;
  }
  while (--d > 0) SEE_GAIN[d - 1] = -Math.max(-SEE_GAIN[d - 1], SEE_GAIN[d]);

  for (let i = lifted - 1; i >= 0; i--) board[SEE_SQS[i]] = SEE_PIECES[i];
  return SEE_GAIN[0];
}

// ─── transposition table ────────────────────────────────────────────────────
const TT_SIZE = 1 << 20;
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
  // Returns the slot index on a hit, -1 otherwise; the caller reads the typed
  // arrays directly so a probe allocates nothing.
  probe(key, lock) {
    const i = key & TT_MASK;
    return this.used[i] && this.keys[i] === key && this.locks[i] === lock ? i : -1;
  }
  store(key, lock, move, score, depth, flag) {
    const i = key & TT_MASK;
    if (this.used[i] && this.keys[i] === key && this.locks[i] === lock) {
      // Same position: keep the deeper result, but never lose a known move.
      if (this.depths[i] > depth && flag !== TT_EXACT) return;
      if (!move) move = this.moves[i];
    }
    this.keys[i] = key; this.locks[i] = lock;
    this.moves[i] = move; this.scores[i] = score;
    this.depths[i] = depth; this.flags[i] = flag;
    this.used[i] = 1;
  }
}

// Mate scores are stored relative to the node, not the root, so a mate found
// through one path is still reported at the right distance through another.
const scoreToTT = (s, ply) => (s > MATE_THRESHOLD ? s + ply : s < -MATE_THRESHOLD ? s - ply : s);
const scoreFromTT = (s, ply) => (s > MATE_THRESHOLD ? s - ply : s < -MATE_THRESHOLD ? s + ply : s);

// ─── search ─────────────────────────────────────────────────────────────────
const MAX_PLY = 64;

// Late-move reduction amounts by [depth][move number].
const LMR = new Int8Array(64 * 64);
for (let d = 1; d < 64; d++) {
  for (let m = 1; m < 64; m++) LMR[d * 64 + m] = Math.floor(0.8 + Math.log(d) * Math.log(m) / 2.4);
}

const styleKey = (style) => Object.keys(DEFAULT_STYLE).map((k) => style?.[k] ?? DEFAULT_STYLE[k]).join(",");

export class Engine {
  constructor() {
    this.tt = new TranspositionTable();
    this.killers = new Int32Array(MAX_PLY * 2);
    this.history = new Int32Array(16 * 128);
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.styleKey = "";
  }

  reset() {
    this.tt.clear();
    this.killers.fill(0);
    this.history.fill(0);
  }

  // The table's scores were produced by one evaluation; another persona's
  // eyes would read them as its own, so a style change starts it afresh.
  useStyle(style) {
    const key = styleKey(style);
    if (key !== this.styleKey) { this.tt.clear(); this.styleKey = key; }
  }

  outOfTime() {
    if (this.aborted) return true;
    // Checking the clock is not free, so only look every 1024 nodes.
    if ((this.nodes & 1023) === 0 && Date.now() >= this.deadline) this.aborted = true;
    return this.aborted;
  }

  scoreMove(pos, move, ply, ttMove) {
    if (move === ttMove) return 2_000_000;
    const flags = moveFlags(move);
    if (flags & FLAG_CAPTURE) {
      const victim = SIMPLE_VALUE[typeOf(moveCaptured(move))];
      const attacker = SIMPLE_VALUE[typeOf(pos.board[moveFrom(move)])];
      // MVV-LVA among captures that hold up; losing ones go to the back.
      if (attacker <= victim || see(pos, move) >= 0) return 1_000_000 + victim * 16 - attacker;
      return -1_000_000 + victim;
    }
    if (flags & FLAG_PROMO) return movePromo(move) === QUEEN ? 950_000 : -900_000;
    if (this.killers[ply * 2] === move) return 900_000;
    if (this.killers[ply * 2 + 1] === move) return 890_000;
    return this.history[pos.board[moveFrom(move)] * 128 + moveTo(move)];
  }

  orderMoves(pos, moves, ply, ttMove) {
    const n = moves.length;
    const scores = new Array(n);
    for (let i = 0; i < n; i++) scores[i] = this.scoreMove(pos, moves[i], ply, ttMove);
    // Insertion sort: move lists are short and mostly ordered already.
    for (let i = 1; i < n; i++) {
      const m = moves[i], s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = m; scores[j + 1] = s;
    }
    return moves;
  }

  quiescence(pos, alpha, beta, style, ply) {
    this.nodes++;
    if (this.outOfTime()) return alpha;
    if (ply >= MAX_PLY - 1) return evaluate(pos, style);

    // In check there is no "standing pat": every evasion has to be looked at,
    // or a mating attack that ends in a quiet check is simply not seen.
    const inCheck = ply < 24 && pos.inCheck();
    let best;
    if (inCheck) {
      best = -MATE_SCORE + ply;
    } else {
      best = evaluate(pos, style);
      if (best >= beta) return best;
      // Delta pruning: even winning a queen wouldn't rescue this node.
      if (best + 1000 < alpha) return alpha;
      if (best > alpha) alpha = best;
    }
    const standPat = best;

    const moves = this.orderMoves(pos, pos.generateMoves(!inCheck), ply, 0);
    for (const move of moves) {
      if (!inCheck) {
        const flags = moveFlags(move);
        if (!(flags & FLAG_PROMO)) {
          // Even the whole captured piece can't lift us to alpha.
          if (standPat + SIMPLE_VALUE[typeOf(moveCaptured(move))] + 200 < alpha) continue;
          if (see(pos, move) < 0) continue;
        }
      }
      if (!pos.makeMove(move)) continue;
      const score = -this.quiescence(pos, -beta, -alpha, style, ply + 1);
      pos.unmakeMove();
      if (this.aborted) return alpha;
      if (score > best) {
        best = score;
        if (score >= beta) return score;
        if (score > alpha) alpha = score;
      }
    }
    return best;
  }

  search(pos, depth, alpha, beta, style, ply, allowNull = true) {
    this.nodes++;
    if (this.outOfTime()) return alpha;

    const pvNode = beta - alpha > 1;
    if (ply > 0) {
      if (pos.isRepetition() || pos.halfmove >= 100) return -style.contempt * 20;
      // Mate-distance pruning: no line from here can beat a mate already found.
      const matedIn = -MATE_SCORE + ply, mateIn = MATE_SCORE - ply - 1;
      if (alpha < matedIn) alpha = matedIn;
      if (beta > mateIn) beta = mateIn;
      if (alpha >= beta) return alpha;
    }
    if (ply >= MAX_PLY - 1) return evaluate(pos, style);

    const inCheck = pos.inCheck();
    if (inCheck) depth++; // check extension — never stop calculating mid-forcing-line

    if (depth <= 0) return this.quiescence(pos, alpha, beta, style, ply);

    const alphaOrig = alpha;
    const tt = this.tt;
    let ttMove = 0;
    const slot = tt.probe(pos.key, pos.lock);
    if (slot >= 0) {
      ttMove = tt.moves[slot];
      if (!pvNode && tt.depths[slot] >= depth) {
        const score = scoreFromTT(tt.scores[slot], ply);
        const flag = tt.flags[slot];
        if (flag === TT_EXACT) return score;
        if (flag === TT_LOWER && score >= beta) return score;
        if (flag === TT_UPPER && score <= alpha) return score;
      }
    }

    const staticEval = inCheck ? -INFINITY_SCORE : evaluate(pos, style);

    if (!pvNode && !inCheck && Math.abs(beta) < MATE_THRESHOLD) {
      // Reverse futility: so far ahead that a shallow search can't lose it.
      if (depth <= 7 && staticEval - 80 * depth >= beta) return staticEval;

      // Null move: if passing still beats beta, the real moves will too.
      // Skipped in likely zugzwang (a side with only pawns left).
      if (allowNull && depth >= 3 && staticEval >= beta && hasNonPawnMaterial(pos, pos.side)) {
        const R = 3 + (depth >> 2) + Math.min(3, ((staticEval - beta) / 200) | 0);
        pos.makeNullMove();
        const score = -this.search(pos, depth - 1 - R, -beta, -beta + 1, style, ply + 1, false);
        pos.unmakeNullMove();
        if (this.aborted) return alpha;
        if (score >= beta) return Math.abs(score) < MATE_THRESHOLD ? score : beta;
      }
    }

    // Without a remembered best move the ordering here is a guess; spend less
    // on it and let the next iteration come back with a proper one.
    if (!ttMove && depth >= 5) depth--;

    const moves = this.orderMoves(pos, pos.generateMoves(false), ply, ttMove);
    let best = -INFINITY_SCORE;
    let bestMove = 0;
    let legal = 0;
    const lmpLimit = 3 + depth * depth;
    const futile = !pvNode && !inCheck && depth <= 4 && staticEval + 110 * depth <= alpha;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!pos.makeMove(move)) continue;
      legal++;

      const flags = moveFlags(move);
      const isQuiet = !(flags & (FLAG_CAPTURE | FLAG_PROMO));
      const givesCheck = pos.inCheck();
      const isKiller = move === this.killers[ply * 2] || move === this.killers[ply * 2 + 1];

      // Prune hopeless quiet moves near the leaves, once something is on the board.
      if (legal > 1 && isQuiet && !givesCheck && !inCheck && !pvNode && best > -MATE_THRESHOLD) {
        if ((depth <= 5 && legal > lmpLimit) || futile) {
          pos.unmakeMove();
          continue;
        }
      }

      let score;
      if (legal === 1) {
        score = -this.search(pos, depth - 1, -beta, -alpha, style, ply + 1);
      } else {
        // Late move reductions: trust the ordering and look at the tail shallowly.
        let reduction = 0;
        if (depth >= 3 && isQuiet && !inCheck && !givesCheck) {
          reduction = LMR[Math.min(depth, 63) * 64 + Math.min(legal, 63)];
          if (pvNode) reduction--;
          if (isKiller) reduction--;
          if (reduction > depth - 2) reduction = depth - 2;
          if (reduction < 0) reduction = 0;
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
              if (this.killers[ply * 2] !== move) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = move;
              }
              const h = pos.board[moveFrom(move)] * 128 + moveTo(move);
              this.history[h] = Math.min(800_000, this.history[h] + depth * depth);
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
    tt.store(pos.key, pos.lock, bestMove, scoreToTT(best, ply), depth, flag);
    return best;
  }

  // One pass over the root moves with a single best line (principal variation
  // search). Returns null if the clock ran out before any move was settled.
  searchRootSingle(pos, ordered, depth, alpha, beta, style) {
    let best = -INFINITY_SCORE, bestMove = 0;
    for (let i = 0; i < ordered.length; i++) {
      const move = ordered[i];
      if (!pos.makeMove(move)) continue;
      let score;
      if (i === 0) {
        score = -this.search(pos, depth - 1, -beta, -alpha, style, 1);
      } else {
        score = -this.search(pos, depth - 1, -alpha - 1, -alpha, style, 1);
        if (!this.aborted && score > alpha && score < beta) score = -this.search(pos, depth - 1, -beta, -alpha, style, 1);
      }
      pos.unmakeMove();
      if (this.aborted) break;
      if (score > best) {
        best = score; bestMove = move;
        if (score > alpha) { alpha = score; if (alpha >= beta) break; }
      }
    }
    return bestMove ? { best, bestMove } : null;
  }

  // Root pass that keeps honest scores for the top `k` moves. Everything else
  // only has to prove it is *not* in the top k, which a zero-width search does
  // far more cheaply than the full-window search every move used to get.
  searchRootMulti(pos, ordered, depth, style, k) {
    const exact = [];
    const rest = [];
    for (const move of ordered) {
      if (!pos.makeMove(move)) continue;
      let score;
      let isExact = true;
      if (exact.length < k) {
        score = -this.search(pos, depth - 1, -INFINITY_SCORE, INFINITY_SCORE, style, 1);
      } else {
        const threshold = exact[k - 1].score;
        score = -this.search(pos, depth - 1, -threshold - 1, -threshold, style, 1);
        if (!this.aborted && score > threshold) {
          score = -this.search(pos, depth - 1, -INFINITY_SCORE, INFINITY_SCORE, style, 1);
        } else {
          isExact = false;
        }
      }
      pos.unmakeMove();
      if (this.aborted) return null;
      if (isExact) {
        let j = exact.length;
        while (j > 0 && exact[j - 1].score < score) j--;
        exact.splice(j, 0, { move, score });
      } else {
        rest.push(move);
      }
    }
    return { exact, rest };
  }

  // Iterative deepening from the root, returning ranked candidate moves.
  // `multiPv` is how many moves need a true evaluation; 1 is fastest and is
  // what the full-strength levels use.
  analyse(pos, { maxDepth = 64, timeMs = 700, style = DEFAULT_STYLE, multiPv = 4, historyKeys = null } = {}) {
    const started = Date.now();
    this.nodes = 0;
    this.aborted = false;
    this.deadline = started + Math.max(30, timeMs);
    this.killers.fill(0);
    this.history.fill(0);
    this.useStyle(style);

    // Earlier positions of the real game, so the search knows which lines
    // repeat — without them it walks happily into a threefold draw.
    const seeded = historyKeys?.length || 0;
    if (seeded) pos.pathKeys.push(...historyKeys);

    try {
      const rootMoves = pos.legalMoves();
      if (!rootMoves.length) {
        return { best: 0, score: pos.inCheck() ? -MATE_SCORE : 0, depth: 0, nodes: 0, lines: [] };
      }

      let ordered = this.orderMoves(pos, rootMoves, 0, 0);
      let bestMove = ordered[0];
      let bestScore = 0;
      let completedDepth = 0;
      let lines = [{ move: bestMove, score: 0 }];
      const k = Math.max(1, multiPv | 0);
      // A lone legal move needs no thought; a few plies are enough for its score.
      const depthCap = rootMoves.length === 1 ? Math.min(maxDepth, 4) : maxDepth;

      for (let depth = 1; depth <= depthCap; depth++) {
        if (k === 1) {
          // Aspiration window around the last score; widen on a miss.
          let delta = 25;
          let alpha = depth >= 4 ? bestScore - delta : -INFINITY_SCORE;
          let beta = depth >= 4 ? bestScore + delta : INFINITY_SCORE;
          let result = null;
          for (;;) {
            result = this.searchRootSingle(pos, ordered, depth, alpha, beta, style);
            if (this.aborted || !result) break;
            if (result.best <= alpha) { alpha = Math.max(-INFINITY_SCORE, alpha - delta); delta *= 2; }
            else if (result.best >= beta) { beta = Math.min(INFINITY_SCORE, beta + delta); delta *= 2; }
            else break;
            if (delta > 1000) { alpha = -INFINITY_SCORE; beta = INFINITY_SCORE; }
          }
          if (this.aborted) {
            // A move that already proved better than the old best inside this
            // unfinished iteration is still the better move.
            if (result && result.bestMove !== bestMove && result.best > bestScore) {
              bestMove = result.bestMove;
              lines = [{ move: bestMove, score: result.best }];
            }
            if (completedDepth > 0) break;
          }
          if (!result) break;
          bestMove = result.bestMove;
          bestScore = result.best;
          ordered = [bestMove, ...ordered.filter((m) => m !== bestMove)];
          lines = [{ move: bestMove, score: bestScore }];
        } else {
          const result = this.searchRootMulti(pos, ordered, depth, style, k);
          if (!result) break;
          const { exact, rest } = result;
          ordered = [...exact.map((e) => e.move), ...rest];
          bestMove = exact[0].move;
          bestScore = exact[0].score;
          lines = exact.slice(0, k);
        }
        completedDepth = depth;

        if (Math.abs(bestScore) > MATE_THRESHOLD) break; // forced mate found
        // The next iteration costs several times this one; don't start what
        // can't finish.
        if (Date.now() - started >= timeMs * 0.5) break;
      }

      return { best: bestMove, score: bestScore, depth: completedDepth, nodes: this.nodes, lines };
    } finally {
      if (seeded) pos.pathKeys.splice(pos.pathKeys.length - seeded, seeded);
    }
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

// `options.history` may list the FENs of earlier positions in the real game
// (oldest first), so the search can see which lines would repeat.
export function analysePosition(fen, options = {}) {
  const pos = Position.fromFen(fen);
  const { history, ...rest } = options;
  const historyKeys = Array.isArray(history) && history.length
    ? history.slice(-100).map((f) => Position.fromFen(f).key)
    : null;
  const result = sharedEngine.analyse(pos, { ...rest, historyKeys });
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
  sharedEngine.useStyle(style);
  sharedEngine.nodes = 0;
  sharedEngine.aborted = false;
  sharedEngine.deadline = Date.now() + Math.max(30, timeMs);
  // Negated: the search runs from the opponent's side after our move.
  const score = -sharedEngine.search(pos, Math.max(1, maxDepth), -INFINITY_SCORE, INFINITY_SCORE, style, 1);
  pos.unmakeMove();
  return score;
}

export { squareName, nameToSquare, typeOf, colorOf, onBoard, fileOf, rankOf, sq0x88, moveFrom, moveTo, moveCaptured, movePromo, moveFlags, FLAG_CAPTURE, FLAG_PROMO, FLAG_CASTLE, FLAG_EP };
