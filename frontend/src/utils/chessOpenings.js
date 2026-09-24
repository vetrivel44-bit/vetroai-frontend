// Chess Arena — grandmaster opening repertoire.
//
// Mainlines as played at the top level, 16–25 plies deep. The full-strength
// levels (Master, and AI vs AI / Spectator) follow these while the game stays
// on one of them, so the opening looks like a real top-level game rather
// than an engine improvising from move five. Once the game leaves every
// line, the search takes over.

export const GRANDMASTER_LINES = [
  // ── 1.e4 c5 ────────────────────────────────────────────────────────────────
  { family: "Sicilian Defence", name: "Sicilian Najdorf, English Attack", moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4" },
  { family: "Sicilian Defence", name: "Sicilian Najdorf, 6.Bg5", moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7 g4 b5" },
  { family: "Sicilian Defence", name: "Sicilian Dragon, Yugoslav Attack", moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O Rc8 Bb3 Ne5" },
  { family: "Sicilian Defence", name: "Sicilian Sveshnikov", moves: "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5 Bxf6 gxf6 Nd5 f5 Bd3 Be6" },
  { family: "Sicilian Defence", name: "Sicilian Taimanov", moves: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be2 a6 O-O Nf6 Be3 Bb4 Na4 Be7" },
  { family: "Sicilian Defence", name: "Sicilian Alapin", moves: "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb5 dxe5 Nxe5 Bd7" },
  // ── 1.e4 e5 ────────────────────────────────────────────────────────────────
  { family: "Ruy López", name: "Ruy López, Closed", moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7" },
  { family: "Ruy López", name: "Ruy López, Berlin Defence", moves: "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8 Nc3 Ke8 h3 h5" },
  { family: "Ruy López", name: "Ruy López, Marshall Attack", moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6 d4 Bd6" },
  { family: "Ruy López", name: "Ruy López, Exchange Variation", moves: "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1 Bg4 f3 Be6" },
  { family: "Italian Game", name: "Italian Game, Giuoco Pianissimo", moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O a6 a4 O-O Re1 Ba7 h3 h6 Nbd2 Re8" },
  { family: "Petrov Defence", name: "Petrov Defence, Classical", moves: "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7 c4 Nb4 Be2 O-O" },
  { family: "Scotch Game", name: "Scotch Game, Mieses Variation", moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6 b3 g6" },
  // ── 1.e4 other ─────────────────────────────────────────────────────────────
  { family: "French Defence", name: "French Defence, Winawer", moves: "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 cxd4" },
  { family: "French Defence", name: "French Defence, Steinitz", moves: "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 cxd4 Nxd4 Bc5 Qd2 O-O" },
  { family: "Caro-Kann Defence", name: "Caro-Kann, Classical", moves: "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bd2 Ngf6 O-O-O Be7" },
  { family: "Caro-Kann Defence", name: "Caro-Kann, Advance Variation", moves: "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7 c4 dxc4" },
  { family: "Scandinavian Defence", name: "Scandinavian, Main Line", moves: "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Qe2 Bb4" },
  // ── 1.d4 d5 ────────────────────────────────────────────────────────────────
  { family: "Queen's Gambit Declined", name: "Queen's Gambit Declined, Tartakower", moves: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5" },
  { family: "Slav Defence", name: "Slav Defence, Main Line", moves: "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O Qe2 Nbd7" },
  { family: "Slav Defence", name: "Semi-Slav, Meran", moves: "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 Bb7 O-O a6 e4 c5 d5" },
  { family: "Queen's Gambit Accepted", name: "Queen's Gambit Accepted, Classical", moves: "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 dxc5 Qxd1 Rxd1 Bxc5" },
  { family: "London System", name: "London System", moves: "d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O Bd3 b6" },
  // ── 1.d4 Nf6 ───────────────────────────────────────────────────────────────
  { family: "Nimzo-Indian Defence", name: "Nimzo-Indian, Rubinstein", moves: "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7" },
  { family: "Nimzo-Indian Defence", name: "Nimzo-Indian, Classical", moves: "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7 f3 h6 Bh4 d5 e3" },
  { family: "King's Indian Defence", name: "King's Indian, Classical Main Line", moves: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Nd3 f5" },
  { family: "Grünfeld Defence", name: "Grünfeld, Exchange Variation", moves: "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3 Qa5 Qd2 O-O Rc1" },
  { family: "Queen's Indian Defence", name: "Queen's Indian, Petrosian Line", moves: "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6 Bc3 d5 Ne5 Nfd7" },
  { family: "Catalan Opening", name: "Catalan, Open Variation", moves: "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7 Bd2" },
  { family: "Dutch Defence", name: "Dutch Defence, Leningrad", moves: "d4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6 Nc3 Qe8 d5 a5" },
  // ── flank openings ─────────────────────────────────────────────────────────
  { family: "English Opening", name: "English, Reversed Sicilian", moves: "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O" },
  { family: "Réti Opening", name: "Réti Opening", moves: "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b5" },
];

const LINES = GRANDMASTER_LINES.map((line) => ({ ...line, sans: line.moves.split(" ") }));

const startsWith = (sans, prefix) => prefix.every((san, i) => sans[i] === san);

/**
 * The next move from the repertoire for a game that has followed one of the
 * lines so far, chosen at random among the lines still in play (so the same
 * pairing does not replay one game). Null once the game has left them all.
 */
export function grandmasterBookMove(historySans, legalSans, rng = Math.random) {
  const candidates = LINES.filter((line) =>
    line.sans.length > historySans.length &&
    startsWith(line.sans, historySans) &&
    legalSans.includes(line.sans[historySans.length]));
  if (!candidates.length) return null;
  const line = candidates[Math.floor(rng() * candidates.length) % candidates.length];
  return { san: line.sans[historySans.length], name: line.name };
}

/**
 * The most specific name the repertoire can give the game so far: the exact
 * variation once the game is committed to one line (or has played through
 * it), otherwise the opening family all remaining lines share.
 */
export function repertoireName(historySans) {
  if (historySans.length < 2) return null;
  // Played the whole line (or more) — the longest such line names it.
  const completed = LINES
    .filter((line) => historySans.length >= line.sans.length && startsWith(historySans, line.sans))
    .sort((a, b) => b.sans.length - a.sans.length)[0];
  if (completed) return completed.name;

  const matching = LINES.filter((line) => startsWith(line.sans, historySans));
  if (!matching.length) {
    // Left the repertoire: name it after the deepest line it followed for a while.
    let best = null, bestDepth = 0;
    for (const line of LINES) {
      let depth = 0;
      while (depth < line.sans.length && depth < historySans.length && line.sans[depth] === historySans[depth]) depth++;
      if (depth > bestDepth) { bestDepth = depth; best = line; }
    }
    return best && bestDepth >= 8 ? best.name : null;
  }
  if (matching.every((line) => line.name === matching[0].name)) return matching[0].name;
  if (matching.every((line) => line.family === matching[0].family)) return matching[0].family;
  return null;
}
