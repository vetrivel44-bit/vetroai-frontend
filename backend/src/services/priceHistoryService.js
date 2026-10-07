const mongoose = require("mongoose");
const logger = require("../utils/logger");

// ── Price history for the Deals screen ───────────────────────────────────────
// Every fresh price check (the hourly refresh, or a search past the cache)
// records a point per product. Responses then carry each product's lowest
// price ever seen, so the screen can say whether today's price is the best
// one yet. MongoDB keeps it across restarts when connected; otherwise it lives
// in memory for the life of the process.

const MAX_POINTS = 4000;              // >4 months of hourly checks, even when prices move every hour
const DAY_MS = 24 * 60 * 60 * 1000;
// A deal must be the lowest price over this look-back window…
const WINDOW_DAYS = 120;
// …and the history must reach back at least this far for the verdict to count.
const MIN_COVERAGE_DAYS = 90;
const SAME_PRICE_GAP_MS = 6 * 60 * 60 * 1000; // unchanged prices are sampled sparser
const MEMORY_MAX = 5000;
const memory = new Map();             // key -> { kind, region, title, store, points, low, high }

const dbReady = () => mongoose.connection?.readyState === 1;

function normTitle(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}
const productKey = (region, item) => `p|${region}|${item.storeId}|${normTitle(item.title)}`;
const queryKey = (region, query) => `q|${region}|${normTitle(query)}`;

function appendPoint(entry, price, at) {
  const last = entry.points[entry.points.length - 1];
  if (!last || last.p !== price || at - new Date(last.t).getTime() >= SAME_PRICE_GAP_MS) {
    entry.points.push({ p: price, t: new Date(at) });
    if (entry.points.length > MAX_POINTS) entry.points.splice(0, entry.points.length - MAX_POINTS);
    // Points older than twice the window no longer affect any verdict.
    const cutoff = at - 2 * WINDOW_DAYS * DAY_MS;
    while (entry.points.length > 1 && new Date(entry.points[0].t).getTime() < cutoff) entry.points.shift();
  }
  if (!entry.low || price < entry.low.p) entry.low = { p: price, t: new Date(at) };
  if (!entry.high || price > entry.high.p) entry.high = { p: price, t: new Date(at) };
}

function recordMemory(key, meta, price, at) {
  let entry = memory.get(key);
  if (!entry) {
    entry = { ...meta, points: [], low: null, high: null };
    if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
  } else {
    memory.delete(key); // re-insert: most recently updated last
  }
  appendPoint(entry, price, at);
  memory.set(key, entry);
}

async function recordDb(rows, at) {
  const PriceHistory = require("../models/PriceHistory");
  const docs = await PriceHistory.find({ key: { $in: rows.map((r) => r.key) } });
  const byKey = new Map(docs.map((d) => [d.key, d]));
  await Promise.all(rows.map(({ key, meta, price }) => {
    const doc = byKey.get(key) || new PriceHistory({ key, ...meta, points: [] });
    const entry = { points: doc.points.map((pt) => ({ p: pt.p, t: pt.t })), low: doc.low?.p != null ? doc.low : null, high: doc.high?.p != null ? doc.high : null };
    appendPoint(entry, price, at);
    doc.points = entry.points;
    doc.low = entry.low;
    doc.high = entry.high;
    doc.title = meta.title || doc.title;
    return doc.save();
  }));
}

// Records the offers from one fresh price check, plus the search's cheapest.
async function recordPrices(query, region, items, at = Date.now()) {
  const rows = items.map((item) => ({
    key: productKey(region, item),
    meta: { kind: "product", region, title: item.title, store: item.store },
    price: item.price,
  }));
  if (items.length) {
    rows.push({ key: queryKey(region, query), meta: { kind: "query", region, title: query, store: "" }, price: Math.min(...items.map((i) => i.price)) });
  }
  for (const r of rows) recordMemory(r.key, r.meta, r.price, at);
  if (dbReady()) {
    try { await recordDb(rows, at); } catch (err) { logger.warn("deals.history.save_failed", { message: err.message }); }
  }
}

async function loadEntries(keys) {
  if (dbReady()) {
    try {
      const PriceHistory = require("../models/PriceHistory");
      const docs = await PriceHistory.find({ key: { $in: keys } }).lean();
      if (docs.length) return new Map(docs.map((d) => [d.key, d]));
    } catch (err) {
      logger.warn("deals.history.load_failed", { message: err.message });
    }
  }
  return new Map(keys.filter((k) => memory.has(k)).map((k) => [k, memory.get(k)]));
}

// Price-history verdict for one offer. `external` points (Keepa) are merged
// with our own checks; together they decide whether today's price is the
// lowest over the last WINDOW_DAYS, with at least MIN_COVERAGE_DAYS of data.
function summarize(entry, currentPrice, external = null, now = Date.now()) {
  const own = (entry?.points || []).map((pt) => ({ p: pt.p, t: new Date(pt.t).getTime() }));
  const ext = (external?.points || []).map((pt) => ({ p: pt.p, t: typeof pt.t === "number" ? pt.t : new Date(pt.t).getTime() }));
  const points = [...ext, ...own].filter((pt) => pt.p > 0 && Number.isFinite(pt.t)).sort((a, b) => a.t - b.t);
  if (!points.length) return null;

  let low = entry?.low ? { p: entry.low.p, t: new Date(entry.low.t).getTime() } : null;
  let high = entry?.high ? { p: entry.high.p, t: new Date(entry.high.t).getTime() } : null;
  for (const pt of points) {
    if (!low || pt.p < low.p) low = pt;
    if (!high || pt.p > high.p) high = pt;
  }
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const inWindow = points.filter((pt) => pt.t >= windowStart);
  let windowLow = { p: currentPrice, t: now };
  for (const pt of inWindow) if (pt.p < windowLow.p) windowLow = pt;
  const coveredDays = Math.floor((now - points[0].t) / DAY_MS);
  const enoughHistory = coveredDays >= MIN_COVERAGE_DAYS;
  const chartFrom = now - WINDOW_DAYS * DAY_MS;
  const chart = points.filter((pt) => pt.t >= chartFrom);

  return {
    source: external?.points?.length ? external.source : "vetroai",
    lowestPrice: low.p,
    lowestAt: new Date(low.t).toISOString(),
    highestPrice: high?.p ?? null,
    trackedSince: new Date(points[0].t).toISOString(),
    checks: own.length,
    coveredDays,
    windowDays: WINDOW_DAYS,
    minCoverageDays: MIN_COVERAGE_DAYS,
    windowLowPrice: windowLow.p,
    windowLowAt: new Date(windowLow.t).toISOString(),
    // The headline verdict: lowest price in 3–4 months, backed by enough data.
    isWindowLow: enoughHistory && currentPrice <= windowLow.p,
    enoughHistory,
    isLowest: currentPrice <= low.p,
    aboveLowestBy: currentPrice > low.p ? Math.round((currentPrice - low.p) * 100) / 100 : 0,
    aboveWindowLowBy: currentPrice > windowLow.p ? Math.round((currentPrice - windowLow.p) * 100) / 100 : 0,
    points: sample(chart.length >= 2 ? chart : points, 40).map((pt) => ({ p: pt.p, t: new Date(pt.t).toISOString() })),
  };
}

// Spark-line points: at most `n`, evenly spread over the history.
function sample(points, n = 24) {
  if (points.length <= n) return points;
  const step = (points.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]);
}

// Adds a `history` summary to each item and returns the search's own
// lowest-ever cheapest offer.
async function attachHistory(query, region, items) {
  const keys = [...items.map((i) => productKey(region, i)), queryKey(region, query)];
  const entries = await loadEntries(keys);
  const withHistory = items.map((item) => {
    const { externalHistory, ...rest } = item;
    return { ...rest, history: summarize(entries.get(productKey(region, item)), item.price, externalHistory) };
  });
  const cheapestNow = items.length ? Math.min(...items.map((i) => i.price)) : null;
  const q = entries.get(queryKey(region, query));
  return { items: withHistory, history: cheapestNow != null ? summarize(q, cheapestNow) : null };
}

module.exports = { recordPrices, attachHistory, summarize, productKey, queryKey, WINDOW_DAYS, MIN_COVERAGE_DAYS, _memory: memory };
