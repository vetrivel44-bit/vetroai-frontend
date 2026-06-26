const logger = require("../utils/logger");

const BASE = "https://cricbuzz-live-api.vercel.app";

// ── In-memory cache (30s TTL) ────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 30_000;

function cached(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.data);
  return fetcher().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

async function safeFetch(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "VetroAI/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Cricbuzz upstream ${res.status}`);
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseTeamScore(scoreStr) {
  if (!scoreStr) return { runs: null, wickets: null, overs: null, raw: "" };
  const m = scoreStr.match(/(\d+)(?:\/(\d+))?\s*(?:\(([^)]+)\))?/);
  return {
    runs: m ? Number(m[1]) : null,
    wickets: m && m[2] ? Number(m[2]) : null,
    overs: m && m[3] ? m[3].trim() : null,
    raw: scoreStr,
  };
}

function detectFormat(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("t20") || t.includes("twenty20") || t.includes("ipl") || t.includes("bbl") || t.includes("psl") || t.includes("cpl")) return "T20";
  if (t.includes("odi") || t.includes("one day")) return "ODI";
  if (t.includes("test")) return "Test";
  return "Unknown";
}

// ── Public API ───────────────────────────────────────────────────────

async function getLiveMatches() {
  return cached("live", async () => {
    const raw = await safeFetch(`${BASE}/matches`);
    const matches = raw.matches || raw.data || raw || [];
    if (!Array.isArray(matches)) return [];

    return matches.map((m) => {
      const score1 = parseTeamScore(m.team1Score || m.team1score);
      const score2 = parseTeamScore(m.team2Score || m.team2score);
      return {
        id: m.id || m.matchId,
        title: m.title || m.matchTitle || "",
        format: detectFormat(m.title || m.matchTitle || m.seriesName || ""),
        status: m.status || m.matchStatus || "",
        venue: m.venue || m.ground || "",
        team1: {
          name: m.team1 || m.team1Name || "",
          shortName: m.team1Short || m.team1Abbreviation || "",
          score: score1.runs,
          wickets: score1.wickets,
          overs: score1.overs,
          scoreRaw: score1.raw,
        },
        team2: {
          name: m.team2 || m.team2Name || "",
          shortName: m.team2Short || m.team2Abbreviation || "",
          score: score2.runs,
          wickets: score2.wickets,
          overs: score2.overs,
          scoreRaw: score2.raw,
        },
        toss: m.toss || m.tossResult || null,
        series: m.seriesName || m.series || "",
        startTime: m.startTime || m.startDate || null,
      };
    });
  });
}

async function getMatchDetails(matchId) {
  return cached(`match:${matchId}`, async () => {
    const [info, scorecard] = await Promise.all([
      safeFetch(`${BASE}/match/${matchId}`).catch(() => null),
      safeFetch(`${BASE}/match/${matchId}/scorecard`).catch(() => null),
    ]);

    const base = info || {};
    const sc = scorecard || {};

    return {
      id: matchId,
      title: base.title || base.matchTitle || "",
      format: detectFormat(base.title || base.matchTitle || base.seriesName || ""),
      status: base.status || base.matchStatus || "",
      venue: base.venue || base.ground || "",
      toss: base.toss || base.tossResult || null,
      series: base.seriesName || base.series || "",
      team1: {
        name: base.team1 || base.team1Name || "",
        shortName: base.team1Short || "",
      },
      team2: {
        name: base.team2 || base.team2Name || "",
        shortName: base.team2Short || "",
      },
      scorecard: sc.scorecard || sc.innings || sc.data || sc || null,
      currentRunRate: base.currentRunRate || base.crr || null,
      requiredRunRate: base.requiredRunRate || base.rrr || null,
      matchSummary: base.status || base.result || null,
    };
  });
}

async function getCommentary(matchId) {
  return cached(`commentary:${matchId}`, async () => {
    const raw = await safeFetch(`${BASE}/match/${matchId}/commentary`);
    const list = raw.commentary || raw.data || raw || [];
    if (!Array.isArray(list)) return { matchId, commentary: [] };

    return {
      matchId,
      commentary: list.map((c) => ({
        text: c.text || c.commText || c.commentary || "",
        ball: c.ball || c.overNumber || null,
        runs: c.runs ?? c.run ?? null,
        isWicket: !!(c.isWicket || c.wicket),
        isBoundary: !!(c.isFour || c.isSix || c.boundary),
        isSix: !!c.isSix,
        isFour: !!c.isFour,
        extras: c.extras || null,
        timestamp: c.timestamp || null,
      })),
    };
  });
}

async function getPlayerInfo(playerId) {
  return cached(`player:${playerId}`, async () => {
    const raw = await safeFetch(`${BASE}/player/${playerId}`);
    const p = raw.player || raw.data || raw || {};
    return {
      id: playerId,
      name: p.name || p.playerName || "",
      team: p.team || p.teamName || "",
      role: p.role || p.playingRole || "",
      battingStyle: p.battingStyle || p.batStyle || null,
      bowlingStyle: p.bowlingStyle || p.bowlStyle || null,
      country: p.country || p.nationality || null,
      dob: p.dob || p.dateOfBirth || null,
      image: p.image || p.faceImageId || null,
      stats: p.stats || p.career || null,
    };
  });
}

module.exports = {
  getLiveMatches,
  getMatchDetails,
  getCommentary,
  getPlayerInfo,
};
