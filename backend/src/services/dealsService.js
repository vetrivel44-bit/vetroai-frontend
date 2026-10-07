const { tavily } = require("@tavily/core");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { searchDDG, searchBingRss } = require("../controllers/searchController");
const { recordPrices, attachHistory } = require("./priceHistoryService");
const { enrichOffers, asinFromUrl } = require("./productExtras");
const canopy = require("./canopyService");

// ── Deals: cheapest current prices across shopping sites ─────────────────────
// Two sources, best first:
//   1. SerpApi's Google Shopping engine (SERPAPI_API_KEY) — structured offers
//      with price, image, rating and the merchant's own link.
//   2. Web search limited to the region's store domains (Tavily, else the
//      keyless DuckDuckGo chain) with the price read out of the title/snippet.
// Every response also carries a direct search link per store, so the person
// can always jump straight to a store even when no offer could be priced.

const REGIONS = {
  in: {
    currency: "INR",
    symbol: "₹",
    gl: "in",
    stores: [
      { id: "amazon", name: "Amazon", domain: "amazon.in", color: "#ff9900", search: (q) => `https://www.amazon.in/s?k=${q}` },
      { id: "flipkart", name: "Flipkart", domain: "flipkart.com", color: "#2874f0", search: (q) => `https://www.flipkart.com/search?q=${q}` },
      { id: "croma", name: "Croma", domain: "croma.com", color: "#00a19a", search: (q) => `https://www.croma.com/searchB?q=${q}` },
      { id: "reliancedigital", name: "Reliance Digital", domain: "reliancedigital.in", color: "#e42529", search: (q) => `https://www.reliancedigital.in/products?q=${q}` },
      { id: "tatacliq", name: "Tata CLiQ", domain: "tatacliq.com", color: "#a6206a", search: (q) => `https://www.tatacliq.com/search/?searchCategory=all&text=${q}` },
      { id: "myntra", name: "Myntra", domain: "myntra.com", color: "#ff3f6c", search: (q) => `https://www.myntra.com/${q}` },
      { id: "ajio", name: "AJIO", domain: "ajio.com", color: "#2c4152", search: (q) => `https://www.ajio.com/search/?text=${q}` },
      { id: "meesho", name: "Meesho", domain: "meesho.com", color: "#9f2089", search: (q) => `https://www.meesho.com/search?q=${q}` },
    ],
  },
  us: {
    currency: "USD",
    symbol: "$",
    gl: "us",
    stores: [
      { id: "amazon", name: "Amazon", domain: "amazon.com", color: "#ff9900", search: (q) => `https://www.amazon.com/s?k=${q}` },
      { id: "walmart", name: "Walmart", domain: "walmart.com", color: "#0071ce", search: (q) => `https://www.walmart.com/search?q=${q}` },
      { id: "bestbuy", name: "Best Buy", domain: "bestbuy.com", color: "#0046be", search: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q}` },
      { id: "target", name: "Target", domain: "target.com", color: "#cc0000", search: (q) => `https://www.target.com/s?searchTerm=${q}` },
      { id: "ebay", name: "eBay", domain: "ebay.com", color: "#e53238", search: (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}` },
      { id: "newegg", name: "Newegg", domain: "newegg.com", color: "#f7a400", search: (q) => `https://www.newegg.com/p/pl?d=${q}` },
    ],
  },
};

// Prices are re-checked every hour: cached results live that long, and the
// refresher below re-runs every tracked search on the same cadence so a
// visitor normally gets an answer fetched within the last hour, instantly.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = REFRESH_INTERVAL_MS;
const CACHE_MAX = 200;
const cache = new Map();

// The Deals screen's category chips — always kept warm.
const FEATURED = {
  in: ["smartphones", "laptops", "wireless earbuds", "smartwatch", "smart tv", "running shoes"],
  us: ["smartphones", "laptops", "wireless earbuds", "smartwatch", "smart tv", "running shoes"],
};
// Searches people ran recently, refreshed hourly for a day after their last use.
const TRACK_MAX = 40;
const TRACK_FOR_MS = 24 * 60 * 60 * 1000;
const tracked = new Map(); // "region|query" -> { region, query, lastUsed }

function regionFor(code) {
  return REGIONS[String(code || "").toLowerCase()] ? String(code).toLowerCase() : "in";
}

function storeForUrl(url, region) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  return REGIONS[region].stores.find((s) => host === s.domain || host.endsWith(`.${s.domain}`)) || null;
}

// Matches the merchant name SerpApi reports ("Amazon.in", "Flipkart", "Croma
// Retail") to one of the region's stores.
function storeForName(name, region) {
  const n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return null;
  return REGIONS[region].stores.find((s) => n.includes(s.id) || n.includes(s.name.toLowerCase().replace(/[^a-z]/g, ""))) || null;
}

function toNumber(text) {
  const n = Number(String(text).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Pulls a price (and an MRP / list price, when one is quoted) out of free text
// such as a search snippet. Instalment amounts ("₹2,500/month", "EMI from")
// are skipped — they are not what the item costs.
function extractPrices(text, region) {
  const src = String(text || "");
  const pattern = region === "us"
    ? /(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g
    : /(?:₹|Rs\.?|INR)\s?(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d{1,2})?/gi;
  const found = [];
  let m;
  while ((m = pattern.exec(src))) {
    const value = toNumber(m[1] + (m[2] || ""));
    if (!value) continue;
    const before = src.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
    if (/emi|cashback|off on|save|discount|extra/.test(before) || /^\s*(?:\/|per\s|a\s)(?:mo|month)|^\s*off\b/.test(after)) continue;
    const isList = /m\.?r\.?p|list price|was|regular|original/.test(before);
    found.push({ value, isList });
  }
  if (!found.length) return null;
  const sale = found.find((f) => !f.isList) || found[0];
  const list = found.find((f) => f.isList && f.value > sale.value);
  return { price: sale.value, originalPrice: list ? list.value : null };
}

function cleanTitle(title, store) {
  let t = String(title || "").replace(/\s+/g, " ").trim();
  // Store sites suffix their own name: "… : Amazon.in: Electronics", "… | Flipkart.com"
  t = t.replace(/\s*[:|\-–]\s*(?:buy\b.*|amazon\.\w+.*|flipkart\.com.*|online at.*)$/i, "");
  if (store) t = t.replace(new RegExp(`\\s*[:|\\-–]\\s*${store.name}.*$`, "i"), "");
  t = t.replace(/^buy\s+/i, "");
  return t.slice(0, 160) || String(title || "").slice(0, 160);
}

function finalize(items, region) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.price || !item.url) continue;
    const key = `${item.storeId}|${item.title.toLowerCase().slice(0, 60)}|${item.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const discountPct = item.originalPrice && item.originalPrice > item.price
      ? Math.round((1 - item.price / item.originalPrice) * 100)
      : null;
    out.push({ ...item, currency: REGIONS[region].currency, discountPct });
  }
  out.sort((a, b) => a.price - b.price);
  return out.map((item, i) => ({ ...item, id: `${item.storeId}-${i}` }));
}

async function searchSerpApi(query, region) {
  const key = config.serpApiKey || process.env.SERPAPI_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: REGIONS[region].gl,
    hl: "en",
    api_key: key,
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`SerpApi ${res.status}`);
  const body = await res.json();
  const rows = [...(body.shopping_results || []), ...(body.inline_shopping_results || [])];
  const items = rows.map((r) => {
    const url = r.link || r.product_link;
    const store = storeForUrl(r.link, region) || storeForName(r.source, region);
    return {
      title: cleanTitle(r.title, store),
      price: typeof r.extracted_price === "number" ? r.extracted_price : (extractPrices(r.price, region)?.price || null),
      originalPrice: typeof r.extracted_old_price === "number" ? r.extracted_old_price : null,
      store: store?.name || r.source || "Store",
      storeId: store?.id || String(r.source || "store").toLowerCase().replace(/[^a-z0-9]/g, ""),
      storeColor: store?.color || null,
      url,
      image: r.thumbnail || null,
      rating: typeof r.rating === "number" ? r.rating : null,
      reviews: typeof r.reviews === "number" ? r.reviews : null,
      delivery: r.delivery || null,
    };
  });
  return finalize(items, region);
}

function webResultsToItems(results, region) {
  const items = [];
  for (const r of results || []) {
    const url = r.url || r.link;
    const store = storeForUrl(url, region);
    if (!store) continue;
    const text = `${r.title || ""} ${r.content || r.snippet || r.description || ""}`;
    const prices = extractPrices(text, region);
    if (!prices) continue;
    items.push({
      title: cleanTitle(r.title, store),
      price: prices.price,
      originalPrice: prices.originalPrice,
      store: store.name,
      storeId: store.id,
      storeColor: store.color,
      url,
      image: null,
      rating: null,
      reviews: null,
      delivery: null,
    });
  }
  return items;
}

async function searchWeb(query, region) {
  const { stores } = REGIONS[region];
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (apiKey) {
    try {
      const client = tavily({ apiKey });
      const res = await Promise.race([
        client.search(`${query} price`, {
          searchDepth: "advanced",
          maxResults: 20,
          includeDomains: stores.map((s) => s.domain),
          includeImages: false,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tavily timeout")), 14000)),
      ]);
      const items = webResultsToItems(res?.results, region);
      if (items.length) return { provider: "tavily", items: finalize(items, region) };
    } catch (err) {
      logger.warn("deals.tavily.error", { query, message: err.message });
    }
  }
  // Keyless: one search per leading store keeps each query's site: filter
  // simple. DuckDuckGo often refuses cloud hosts, so Bing RSS backs it up.
  const lead = stores.slice(0, 4);
  const batches = await Promise.all(lead.map(async (s) => {
    const q = `${query} price site:${s.domain}`;
    const ddg = await searchDDG(q, {}).catch(() => []);
    return ddg.length ? ddg : searchBingRss(q, {}).catch(() => []);
  }));
  return { provider: "web", items: finalize(webResultsToItems(batches.flat(), region), region) };
}

async function findDeals(rawQuery, regionCode, { force = false, track = true } = {}) {
  const query = String(rawQuery || "").trim().slice(0, 120);
  const region = regionFor(regionCode);
  const encoded = encodeURIComponent(query);
  const storeLinks = REGIONS[region].stores.map((s) => ({
    id: s.id, name: s.name, color: s.color, domain: s.domain, url: s.search(encoded),
  }));

  const cacheKey = `${region}|${query.toLowerCase()}`;
  if (track && query) {
    tracked.delete(cacheKey);
    tracked.set(cacheKey, { region, query, lastUsed: Date.now() });
    if (tracked.size > TRACK_MAX) tracked.delete(tracked.keys().next().value);
  }
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return respond({ ...hit.value, cached: true }, hit.at);

  let provider = null;
  let items = [];
  // Amazon straight from Canopy, in parallel with the multi-store search.
  const amazonStore = REGIONS[region].stores.find((st) => st.id === "amazon");
  const canopyPending = canopy.searchAmazon(query, region, amazonStore);
  try {
    const serp = await searchSerpApi(query, region);
    if (serp?.length) { provider = "google-shopping"; items = serp; }
  } catch (err) {
    logger.warn("deals.serpapi.error", { query, message: err.message });
  }
  if (!items.length) {
    const web = await searchWeb(query, region);
    provider = web.provider;
    items = web.items;
  }
  const canopyItems = await canopyPending;
  if (canopyItems.length) {
    // Canopy's Amazon listing wins over another source's copy of the same ASIN.
    const asins = new Set(canopyItems.map((i) => i.asin).filter(Boolean));
    const others = items.filter((i) => !(i.storeId === "amazon" && asins.has(asinFromUrl(i.url))));
    items = finalize([...canopyItems.slice(0, 20), ...others], region);
    provider = provider && others.length ? `${provider}+canopy` : "canopy";
  }
  // Long-range price history (Keepa) and full-size product photos.
  items = await enrichOffers(items.slice(0, 40), region, (url) => storeForUrl(url, region));

  const value = {
    query,
    region,
    currency: REGIONS[region].currency,
    symbol: REGIONS[region].symbol,
    provider,
    fetchedAt: new Date().toISOString(),
    items: items.slice(0, 40),
    storeLinks,
  };
  const at = Date.now();
  if (items.length) {
    await recordPrices(query, region, value.items, at);
    cache.delete(cacheKey);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at, value });
  } else if (hit) {
    // A failed refresh keeps showing the last good prices rather than nothing.
    return respond({ ...hit.value, cached: true, stale: true }, hit.at);
  }
  return respond(value, at);
}

// Adds the refresh schedule and each offer's price history to a result.
async function respond(value, at) {
  const { items, history } = await attachHistory(value.query, value.region, value.items);
  return {
    ...value,
    items,
    history,
    nextRefreshAt: new Date(at + REFRESH_INTERVAL_MS).toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
  };
}

// Featured categories for a region, each answered from the hourly cache.
async function featuredDeals(regionCode) {
  const region = regionFor(regionCode);
  const sections = await Promise.all(FEATURED[region].map(async (query) => {
    const res = await findDeals(query, region, { track: false }).catch(() => null);
    return { query, items: res?.items?.slice(0, 20) || [], fetchedAt: res?.fetchedAt || null };
  }));
  return {
    region,
    currency: REGIONS[region].currency,
    symbol: REGIONS[region].symbol,
    sections,
    refreshIntervalMs: REFRESH_INTERVAL_MS,
  };
}

// Re-runs every featured and recently used search, one at a time so a
// refresh never bursts the search providers.
async function refreshAll() {
  const now = Date.now();
  for (const [key, t] of tracked) {
    if (now - t.lastUsed > TRACK_FOR_MS) tracked.delete(key);
  }
  const jobs = [];
  for (const region of Object.keys(REGIONS)) {
    for (const query of FEATURED[region]) jobs.push({ region, query });
  }
  for (const t of tracked.values()) {
    if (!jobs.some((j) => j.region === t.region && j.query.toLowerCase() === t.query.toLowerCase())) jobs.push(t);
  }
  let ok = 0;
  for (const job of jobs) {
    try {
      const res = await findDeals(job.query, job.region, { force: true, track: false });
      if (res.items.length && !res.stale) ok++;
    } catch (err) {
      logger.warn("deals.refresh.error", { query: job.query, message: err.message });
    }
  }
  logger.info("deals.refresh.done", { searches: jobs.length, updated: ok });
}

let refreshTimer = null;
function startDealsRefresher() {
  if (refreshTimer) return;
  const run = () => refreshAll().catch((err) => logger.warn("deals.refresh.failed", { message: err.message }));
  setTimeout(run, 15 * 1000).unref?.();
  refreshTimer = setInterval(run, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

module.exports = {
  findDeals, featuredDeals, refreshAll, startDealsRefresher,
  extractPrices, storeForUrl, cleanTitle, REGIONS, REFRESH_INTERVAL_MS, _cache: cache, _tracked: tracked,
};
