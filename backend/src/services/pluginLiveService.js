"use strict";

// Live data for VetroAI's live plugins (frontend src/plugins/catalog.js):
// Live Sports, Weather, News Brief, Markets and Currency.
//
// Before the model answers a message that uses one of them, the real
// figures are fetched here and handed to it as a LIVE DATA block, so a
// score, a temperature or a price is never made up. When a service needs a
// key that isn't set, the block carries the exact notice to give instead
// ("Live Sports isn't connected yet — add CRICAPI_KEY").
//
// Keys come from the environment only (config/env.js): HIGHLIGHTLY_API_KEY
// (cricket and football; CRICAPI_KEY and API_SPORTS_KEY are fallbacks),
// NEWS_API_KEY, ALPHAVANTAGE_API_KEY. Weather (Open-Meteo),
// currency (Frankfurter) and crypto (CoinGecko) need none.

const { config } = require("../config/env");
const logger = require("../utils/logger");

// Which live source a plugin uses. Decided here, never by the browser.
const LIVE_KIND_BY_PLUGIN = Object.freeze({
  "sports-live": "sports",
  "weather-now": "weather",
  "news-brief": "news",
  markets: "markets",
  "currency-convert": "currency",
});
const PLUGIN_NAME = { sports: "Live Sports", weather: "Weather", news: "News Brief", markets: "Markets", currency: "Currency" };

const TIMEOUT_MS = 9000;
const CACHE_MS = 60_000;
const cache = new Map();

async function getJson(url, { headers = {}, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "VetroAI/1.0", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const reason = body?.reason || body?.message || body?.error || text.slice(0, 120) || `HTTP ${res.status}`;
    const err = new Error(String(reason));
    err.status = res.status;
    throw err;
  }
  return body;
}

const notConnected = (kind, envVar, what = "") => ({
  kind, connected: false, envVar,
  notice: `${PLUGIN_NAME[kind]} isn't connected${what ? ` for ${what}` : ""} yet — add ${envVar}`,
});

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const words = (text) => String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];

// ── Live Sports ─────────────────────────────────────────────────────────
const CRICKET_RE = /\b(cricket|ipl|t20|t20i|odi|test match|bbl|psl|wpl|ranji|innings|wickets?|sixes|bowl(?:er|ing)?|bat(?:ter|ting)?)\b/i;
const FOOTBALL_RE = /\b(football|soccer|premier league|epl|la ?liga|serie a|bundesliga|ligue 1|champions league|ucl|isl|mls|fifa|goals?)\b/i;
const SPORTS_FILLER = new Set(["live", "score", "scores", "match", "matches", "today", "now", "current", "who", "is", "winning", "the", "of", "vs", "v", "versus", "and", "game", "fixture", "fixtures", "result", "results", "cricket", "football", "soccer", "what", "whats", "in", "for", "show", "me", "latest", "update", "updates", "status", "sports"]);

/** "cricket" unless the message is clearly about football. */
function sportFor(query) {
  return FOOTBALL_RE.test(query) && !CRICKET_RE.test(query) ? "football" : "cricket";
}

// The words naming a team or competition: "india australia" from "India vs Australia score".
const teamWords = (query) => words(query).filter((w) => w.length >= 3 && !SPORTS_FILLER.has(w));
// A wanted word names a team when it is one of the name's words, or a clear
// start of one ("austr" → Australia); "india" is not "Indian" (Premier League).
const wordHit = (w, nameWord) => nameWord === w || (w.length >= 4 && nameWord.startsWith(w) && nameWord.length - w.length >= 3);
const matchesTeams = (names, wanted) => !wanted.length || wanted.some((w) => names.some((n) => words(n).some((nw) => wordHit(w, nw))));

function formatCricket(match) {
  const scores = (match.score || []).map((s) => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join("; ");
  return `- ${match.name}${match.matchType ? ` [${String(match.matchType).toUpperCase()}]` : ""}${scores ? ` — ${scores}` : ""} — ${match.status || (match.matchStarted ? "in progress" : "not started")}${match.venue ? ` (${match.venue})` : ""}`;
}

// ── Highlightly (cricket and football, one key) ──
// Docs: https://highlightly.net/cricket-api/documentation/matches/ and
// /football-api/documentation/matches/. Direct calls send the key alone in
// x-rapidapi-key; the matches list needs a filter (here: the date) and is
// refreshed once a minute. A FREE plan may hide some matches.
const HIGHLIGHTLY_BASE = { cricket: "https://cricket.highlightly.net", football: "https://soccer.highlightly.net" };

/** "2026-11-22" in `timezone` (an IANA name), UTC if it isn't one. */
function dateIn(timezone, offsetDays = 0, now = Date.now()) {
  const when = new Date(now + offsetDays * 86_400_000);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(when); }
  catch { return when.toISOString().slice(0, 10); }
}
const validZone = (timezone) => { try { new Intl.DateTimeFormat("en", { timeZone: timezone }); return Boolean(timezone); } catch { return false; } };

// Live first, then breaks, then not started, then over.
const STATE_ORDER = (state) => {
  const s = String(state || "").toLowerCase();
  if (/in play|in progress|first half|second half|extra time|penalties/.test(s)) return 0;
  if (/break|drinks|lunch|tea|stumps|timeout|half time|delayed|interrupted|suspended/.test(s)) return 1;
  if (/scheduled|not started|to be announced/.test(s)) return 2;
  return 3;
};
const OVER = /finished|cancelled|abandoned|postponed|awarded/i;

async function highlightlyMatches(sport, date, timezone, fetchImpl) {
  const params = new URLSearchParams({ date, limit: "100" });
  if (timezone) params.set("timezone", timezone);
  const body = await getJson(`${HIGHLIGHTLY_BASE[sport]}/matches?${params}`, { headers: { "x-rapidapi-key": config.highlightlyApiKey }, fetchImpl });
  return { matches: Array.isArray(body?.data) ? body.data : [], tier: body?.plan?.tier || "" };
}

function formatHighlightlyCricket(m) {
  const home = m.homeTeam?.name || "Home";
  const away = m.awayTeam?.name || "Away";
  const t = m.state?.teams || {};
  const side = (name, team) => (team?.score ? `${name} ${team.score}${team.info ? ` (${team.info})` : ""}` : "");
  const scores = [side(home, t.home), side(away, t.away)].filter(Boolean).join("; ");
  const when = m.startTime ? ` · starts ${m.startTime.replace("T", " ").slice(0, 16)} UTC` : "";
  return `- ${home} vs ${away} (${[m.league?.name, m.format].filter(Boolean).join(", ")})${scores ? ` — ${scores}` : ""} — ${m.state?.description || "Unknown"}${m.state?.report ? `: ${m.state.report}` : ""}${!scores && STATE_ORDER(m.state?.description) === 2 ? when : ""}`;
}

function formatHighlightlyFootball(m) {
  const score = m.state?.score?.current;
  const pens = m.state?.score?.penalties ? ` (pens ${m.state.score.penalties})` : "";
  const clock = m.state?.clock ? `, ${m.state.clock}'` : "";
  const when = !score && m.date ? ` · kick-off ${m.date.replace("T", " ").slice(0, 16)} UTC` : "";
  return `- ${m.homeTeam?.name} ${score || "vs"} ${m.awayTeam?.name}${pens} (${m.league?.name || ""}; ${m.state?.description || "Unknown"}${clock})${when}`;
}

async function highlightly(sport, query, fetchImpl, { timezone } = {}) {
  const zone = validZone(timezone) ? timezone : "";
  const today = await highlightlyMatches(sport, dateIn(zone), zone, fetchImpl);
  let all = today.matches;
  // A Test match runs for days: one that started yesterday and isn't over is still on.
  if (sport === "cricket") {
    const yesterday = await highlightlyMatches(sport, dateIn(zone, -1), zone, fetchImpl).catch(() => ({ matches: [] }));
    const seen = new Set(all.map((m) => String(m.id)));
    all = all.concat(yesterday.matches.filter((m) => !seen.has(String(m.id)) && !OVER.test(m.state?.description || "")));
  }
  all.sort((a, b) => STATE_ORDER(a.state?.description) - STATE_ORDER(b.state?.description));
  const wanted = teamWords(query);
  const names = (m) => [m.homeTeam?.name || "", m.awayTeam?.name || "", m.homeTeam?.abbreviation || "", m.awayTeam?.abbreviation || "", m.league?.name || ""];
  const hits = all.filter((m) => matchesTeams(names(m), wanted));
  const shown = (hits.length ? hits : all).slice(0, sport === "cricket" ? 8 : 10);
  const lines = [];
  if (wanted.length && !hits.length) lines.push(`No ${sport} match today for "${wanted.join(" ")}". Today's matches instead:`);
  lines.push(...shown.map(sport === "cricket" ? formatHighlightlyCricket : formatHighlightlyFootball));
  if (!shown.length) lines.push(`No ${sport} matches today.`);
  if (/free/i.test(today.tier)) lines.push("(Free Highlightly plan: some matches may be hidden.)");
  return { kind: "sports", connected: true, source: `Highlightly ${sport === "cricket" ? "Cricket" : "Football"} API`, lines };
}

async function cricket(query, fetchImpl, options) {
  if (config.highlightlyApiKey) return highlightly("cricket", query, fetchImpl, options);
  if (!config.cricapiKey) return notConnected("sports", "HIGHLIGHTLY_API_KEY");
  const body = await getJson(`https://api.cricapi.com/v1/currentMatches?apikey=${encodeURIComponent(config.cricapiKey)}&offset=0`, { fetchImpl });
  if (body?.status && body.status !== "success") throw new Error(body.reason || "CricAPI refused the request");
  const all = Array.isArray(body?.data) ? body.data : [];
  const wanted = teamWords(query);
  const hits = all.filter((m) => matchesTeams([m.name || "", ...(m.teams || [])], wanted));
  const shown = (hits.length ? hits : all).slice(0, 8);
  const lines = [];
  if (wanted.length && !hits.length) lines.push(`No current match found for "${wanted.join(" ")}". Current matches instead:`);
  lines.push(...shown.map(formatCricket));
  if (!shown.length) lines.push("No cricket matches are on right now.");
  return { kind: "sports", connected: true, source: "CricAPI", lines };
}

async function football(query, fetchImpl, options) {
  if (config.highlightlyApiKey) return highlightly("football", query, fetchImpl, options);
  if (!config.apiSportsKey) return notConnected("sports", "HIGHLIGHTLY_API_KEY", "football");
  const body = await getJson("https://v3.football.api-sports.io/fixtures?live=all", { headers: { "x-apisports-key": config.apiSportsKey }, fetchImpl });
  const errors = body?.errors && Object.values(body.errors).filter(Boolean);
  if (errors?.length) throw new Error(String(errors[0]));
  const all = Array.isArray(body?.response) ? body.response : [];
  const wanted = teamWords(query);
  const hits = all.filter((f) => matchesTeams([f.teams?.home?.name || "", f.teams?.away?.name || "", f.league?.name || ""], wanted));
  const shown = (hits.length ? hits : all).slice(0, 10);
  const lines = [];
  if (wanted.length && !hits.length) lines.push(`No live match found for "${wanted.join(" ")}". Live matches instead:`);
  lines.push(...shown.map((f) => `- ${f.teams?.home?.name} ${f.goals?.home ?? "-"}–${f.goals?.away ?? "-"} ${f.teams?.away?.name} (${f.league?.name}; ${f.fixture?.status?.long || ""}${f.fixture?.status?.elapsed ? `, ${f.fixture.status.elapsed}'` : ""})`));
  if (!shown.length) lines.push("No football matches are live right now.");
  return { kind: "sports", connected: true, source: "API-Football", lines };
}

// Highlightly first (HIGHLIGHTLY_API_KEY, both sports); CricAPI and
// API-Football remain as fallbacks for setups that already have those keys.
const sports = (query, fetchImpl, deps, options) => (sportFor(query) === "football" ? football(query, fetchImpl, options) : cricket(query, fetchImpl, options));

// ── Weather ─────────────────────────────────────────────────────────────
const WEATHER_CODES = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};
const WEATHER_TAIL = /\b(today|tonight|tomorrow|now|right now|this week|this weekend|currently|please|forecast|weather|temperature|like|outside)\b/gi;

/** The place a weather question is about: "Chennai" from "weather in Chennai today?". */
function placeFor(query) {
  const q = String(query || "").replace(/[?!.]+$/g, " ").trim();
  const patterns = [
    /\b(?:in|at|for|of|near)\s+([a-z][a-z .,'-]{1,60})$/i,
    /\b(?:weather|forecast|temperature|rain(?:ing)?|climate)\s+(?:in|at|for|of)?\s*([a-z][a-z .,'-]{1,60})/i,
    /^([a-z][a-z .,'-]{1,40}?)\s+(?:weather|forecast|temperature)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(q);
    if (!m) continue;
    const place = m[1].replace(WEATHER_TAIL, " ").replace(/\b(?:in|at|for|of|the|is|it|what|how)\b/gi, " ").replace(/\s+/g, " ").replace(/^[ ,.-]+|[ ,.-]+$/g, "").trim();
    if (place.length >= 2) return place;
  }
  return "";
}

async function weather(query, fetchImpl) {
  const place = placeFor(query);
  if (!place) return { kind: "weather", connected: true, source: "Open-Meteo", lines: ["No place was named. Ask the user which city."] };
  const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place.split(",")[0])}&count=1&language=en&format=json`, { fetchImpl });
  const spot = geo?.results?.[0];
  if (!spot) return { kind: "weather", connected: true, source: "Open-Meteo", lines: [`No place called "${place}" was found. Ask the user to check the name.`] };
  const params = new URLSearchParams({
    latitude: spot.latitude, longitude: spot.longitude, timezone: "auto", forecast_days: "4",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  });
  const wx = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, { fetchImpl });
  const c = wx?.current || {};
  const d = wx?.daily || {};
  const where = [spot.name, spot.admin1, spot.country].filter(Boolean).join(", ");
  const lines = [
    `${where} — now (${c.time || "latest"} local): ${c.temperature_2m}°C, feels like ${c.apparent_temperature}°C, ${WEATHER_CODES[c.weather_code] || "conditions unknown"}, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h, precipitation ${c.precipitation} mm.`,
  ];
  (d.time || []).forEach((day, i) => {
    lines.push(`- ${day}: ${WEATHER_CODES[d.weather_code?.[i]] || "—"}, ${d.temperature_2m_min?.[i]}–${d.temperature_2m_max?.[i]}°C, rain chance ${d.precipitation_probability_max?.[i] ?? "?"}%`);
  });
  return { kind: "weather", connected: true, source: "Open-Meteo", lines };
}

// ── News ────────────────────────────────────────────────────────────────
const NEWS_FILLER = new Set(["news", "latest", "today", "todays", "headlines", "headline", "breaking", "about", "on", "the", "of", "what", "is", "are", "any", "me", "show", "give", "top", "current", "updates", "update", "brief"]);

async function news(query, fetchImpl, deps = {}) {
  const { headlinesFor } = deps.news || require("../controllers/externalDataController");
  const topic = words(query).filter((w) => !NEWS_FILLER.has(w)).slice(0, 6).join(" ");
  const result = await headlinesFor(topic);
  if (!result) return notConnected("news", "NEWS_API_KEY");
  const lines = result.articles.slice(0, 8).map((a) => `- ${a.title}${a.source_name || a.source_id ? ` — ${a.source_name || a.source_id}` : ""}${a.pubDate ? ` (${a.pubDate})` : ""}${a.link ? ` ${a.link}` : ""}`);
  if (!lines.length) lines.push(`No recent headlines found${topic ? ` for "${topic}"` : ""}.`);
  return { kind: "news", connected: true, source: result.provider, lines };
}

// ── Markets ─────────────────────────────────────────────────────────────
const COINS = {
  bitcoin: "bitcoin", btc: "bitcoin", ethereum: "ethereum", eth: "ethereum", ether: "ethereum", solana: "solana", sol: "solana",
  dogecoin: "dogecoin", doge: "dogecoin", xrp: "ripple", ripple: "ripple", cardano: "cardano", ada: "cardano",
  bnb: "binancecoin", tether: "tether", usdt: "tether", litecoin: "litecoin", ltc: "litecoin", toncoin: "the-open-network", ton: "the-open-network",
  shiba: "shiba-inu", shib: "shiba-inu", polkadot: "polkadot", dot: "polkadot", tron: "tron", trx: "tron",
};
const STOCKS = {
  apple: "AAPL", tesla: "TSLA", microsoft: "MSFT", google: "GOOGL", alphabet: "GOOGL", amazon: "AMZN", nvidia: "NVDA",
  meta: "META", facebook: "META", netflix: "NFLX", amd: "AMD", intel: "INTC", reliance: "RELIANCE.BSE", tcs: "TCS.BSE",
  infosys: "INFY", wipro: "WIT", hdfc: "HDB", icici: "IBN", tata: "TTM",
};
const TICKER_RE = /\$?\b([A-Z]{2,5}(?:\.[A-Z]{2,4})?)\b/g;
const NOT_TICKERS = new Set(["USD", "INR", "EUR", "GBP", "BTC", "ETH", "CEO", "IPO", "ETF", "NSE", "BSE", "API", "AI", "THE", "AND", "WHAT", "IS", "OF"]);

/** Coins and stock symbols a message asks about. */
function marketsFor(query) {
  const low = words(query);
  const coins = [...new Set(low.map((w) => COINS[w]).filter(Boolean))];
  const stocks = new Set(low.map((w) => STOCKS[w]).filter(Boolean));
  for (const m of String(query).matchAll(TICKER_RE)) if (!NOT_TICKERS.has(m[1]) && !COINS[m[1].toLowerCase()]) stocks.add(m[1]);
  return { coins, stocks: [...stocks].slice(0, 4) };
}

async function markets(query, fetchImpl) {
  const { coins, stocks } = marketsFor(query);
  const wantCoins = coins.length ? coins : stocks.length ? [] : ["bitcoin", "ethereum"];
  const lines = [];
  const sources = [];
  let stockNotice = null;
  if (wantCoins.length) {
    const prices = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${wantCoins.join(",")}&vs_currencies=usd,inr&include_24hr_change=true&include_last_updated_at=true`, { fetchImpl });
    sources.push("CoinGecko");
    for (const id of wantCoins) {
      const p = prices?.[id];
      if (!p) { lines.push(`- ${id}: no price returned`); continue; }
      const change = typeof p.usd_24h_change === "number" ? `${p.usd_24h_change >= 0 ? "+" : ""}${p.usd_24h_change.toFixed(2)}% in 24h` : "";
      const at = p.last_updated_at ? new Date(p.last_updated_at * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
      lines.push(`- ${id}: $${p.usd?.toLocaleString("en-US")} / ₹${p.inr?.toLocaleString("en-IN")}${change ? `, ${change}` : ""}${at ? ` (as of ${at})` : ""}`);
    }
  }
  if (stocks.length) {
    if (!config.alphaVantageKey) {
      stockNotice = notConnected("markets", "ALPHAVANTAGE_API_KEY", "stocks").notice;
      lines.push(`- Stocks asked (${stocks.join(", ")}): ${stockNotice}.`);
    } else {
      sources.push("Alpha Vantage");
      for (const symbol of stocks) {
        const q = await getJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(config.alphaVantageKey)}`, { fetchImpl });
        const g = q?.["Global Quote"];
        if (q?.Note || q?.Information) { lines.push(`- ${symbol}: the stock service is rate-limited right now (${String(q.Note || q.Information).slice(0, 80)})`); break; }
        if (!g || !g["05. price"]) { lines.push(`- ${symbol}: no quote found`); continue; }
        lines.push(`- ${symbol}: ${Number(g["05. price"]).toFixed(2)} (${g["09. change"]}, ${g["10. change percent"]}) on ${g["07. latest trading day"]}`);
      }
    }
  }
  if (!wantCoins.length && stockNotice) return { kind: "markets", connected: false, envVar: "ALPHAVANTAGE_API_KEY", notice: stockNotice };
  return { kind: "markets", connected: true, source: sources.join(" + "), lines };
}

// ── Currency ────────────────────────────────────────────────────────────
const CURRENCY_NAMES = {
  dollar: "USD", dollars: "USD", usd: "USD", "$": "USD", rupee: "INR", rupees: "INR", rs: "INR", inr: "INR", "₹": "INR",
  euro: "EUR", euros: "EUR", eur: "EUR", "€": "EUR", pound: "GBP", pounds: "GBP", sterling: "GBP", gbp: "GBP", "£": "GBP",
  yen: "JPY", jpy: "JPY", yuan: "CNY", renminbi: "CNY", cny: "CNY", aud: "AUD", cad: "CAD", sgd: "SGD", chf: "CHF",
  franc: "CHF", ringgit: "MYR", myr: "MYR", baht: "THB", thb: "THB", won: "KRW", krw: "KRW", nzd: "NZD", hkd: "HKD",
  dirham: "AED", aed: "AED", riyal: "SAR", sar: "SAR", taka: "BDT", lkr: "LKR", npr: "NPR", zar: "ZAR", rand: "ZAR",
  sek: "SEK", nok: "NOK", dkk: "DKK", pln: "PLN", try: "TRY", lira: "TRY", mxn: "MXN", brl: "BRL", real: "BRL", idr: "IDR", php: "PHP",
};

/** { amount, from, to } from "convert 100 usd to inr" / "dollar to rupee". */
function conversionFor(query) {
  const tokens = String(query || "").toLowerCase().replace(/([$₹€£])/g, " $1 ").match(/[a-z]+|\d[\d,]*(?:\.\d+)?|[$₹€£]/g) || [];
  const codes = [];
  let amount = null;
  for (const t of tokens) {
    if (/^\d/.test(t) && amount === null) amount = Number(t.replace(/,/g, ""));
    else if (CURRENCY_NAMES[t] && !codes.includes(CURRENCY_NAMES[t])) codes.push(CURRENCY_NAMES[t]);
  }
  if (!codes.length) return null;
  const [from, to] = codes.length === 1 ? (codes[0] === "INR" ? ["USD", "INR"] : [codes[0], "INR"]) : codes;
  return { amount: amount && amount > 0 ? amount : 1, from, to };
}

async function currency(query, fetchImpl) {
  const pair = conversionFor(query);
  if (!pair) return { kind: "currency", connected: true, source: "Frankfurter", lines: ["No currencies were named. Ask which ones to convert."] };
  try {
    const body = await getJson(`https://api.frankfurter.dev/v1/latest?amount=${pair.amount}&from=${pair.from}&to=${pair.to}`, { fetchImpl });
    const value = body?.rates?.[pair.to];
    if (typeof value !== "number") throw new Error("no rate returned");
    const rate = value / pair.amount;
    return { kind: "currency", connected: true, source: "Frankfurter (European Central Bank reference rates)", lines: [`${pair.amount} ${pair.from} = ${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${pair.to} (1 ${pair.from} = ${rate.toFixed(4)} ${pair.to}; rate date ${body.date}).`] };
  } catch (err) {
    if (err.status === 404 || err.status === 422) return { kind: "currency", connected: true, source: "Frankfurter", lines: [`${pair.from} → ${pair.to} isn't covered by the reference-rate service (it lists about 30 major currencies).`] };
    throw err;
  }
}

const HANDLERS = { sports, weather, news, markets, currency };

/**
 * Live data for one source and message: { kind, connected, source, lines }
 * or { kind, connected: false, envVar, notice }, or { kind, error }.
 * Cached for a minute per source and message.
 */
async function fetchLive(kind, query, { fetchImpl = fetch, deps, timezone } = {}) {
  const handler = HANDLERS[kind];
  if (!handler) return { kind, error: "unknown live source" };
  const key = `${kind}:${timezone || ""}:${String(query || "").toLowerCase().trim().slice(0, 200)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value;
  try {
    value = await handler(String(query || ""), fetchImpl, deps, { timezone });
    value.fetchedAt = stamp();
  } catch (err) {
    logger.warn("pluginLive.failed", { kind, error: err.message });
    value = { kind, error: err.message || "the service didn't answer" };
  }
  if (!value.error) cache.set(key, { at: Date.now(), value });
  return value;
}

/** The LIVE DATA block the model gets for one result. */
function liveBlock(result) {
  const name = PLUGIN_NAME[result.kind] || result.kind;
  if (result.connected === false) {
    return `LIVE DATA — ${name}: NOT CONNECTED.\nThe live service has no key on the server, so no real data is available. Say exactly: "${result.notice}." Do not give, guess or recall any figures for this.`;
  }
  if (result.error) {
    return `LIVE DATA — ${name}: the live service didn't answer just now (${String(result.error).slice(0, 120)}). Say the live data couldn't be fetched right now; do not guess or recall figures.`;
  }
  return `LIVE DATA — ${name} (source: ${result.source}; fetched ${result.fetchedAt}):\n${result.lines.join("\n")}\nUse only these figures for live values and name the source and time. If the user asked for something not listed here, say it isn't in the live data.`;
}

/**
 * The live part of the system prompt for the plugins a message uses: the
 * ids of the live plugins among them are looked up here, fetched in parallel.
 */
async function liveContextFor(pluginIds = [], query = "", options = {}) {
  const kinds = [...new Set(pluginIds.map((id) => LIVE_KIND_BY_PLUGIN[id]).filter(Boolean))];
  if (!kinds.length) return { prompt: "", results: [] };
  const results = await Promise.all(kinds.map((kind) => fetchLive(kind, query, options)));
  return { prompt: `\n\n# LIVE DATA FROM PLUGINS\n${results.map(liveBlock).join("\n\n")}`, results };
}

/** Which keyed connectors are set up, for the Plugins page. No values. */
function connectorStatus() {
  return {
    highlightly: Boolean(config.highlightlyApiKey),
    cricapi: Boolean(config.cricapiKey),
    "api-sports": Boolean(config.apiSportsKey),
    newsdata: Boolean(config.newsDataApiKey || config.firecrawlApiKey),
    alphavantage: Boolean(config.alphaVantageKey),
    tavily: Boolean(config.tavilyApiKey),
    "google-maps": Boolean(config.googleMapsApiKey),
    jsearch: Boolean(config.jsearchApiKey),
    "open-meteo": true,
    frankfurter: true,
    coingecko: true,
  };
}

const clearCache = () => cache.clear();

module.exports = {
  LIVE_KIND_BY_PLUGIN, fetchLive, liveBlock, liveContextFor, connectorStatus, clearCache,
  // for tests
  sportFor, teamWords, placeFor, marketsFor, conversionFor, dateIn,
};
