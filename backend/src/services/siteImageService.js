const config = require("../config/env");
const logger = require("../utils/logger");

// Pictures for websites the AI builds (Computer mode, Design). The page asks
// for a subject — "red running shoes", "barista pouring latte art" — and gets
// a photo of that, instead of picsum.photos' random animals and flowers on a
// shoe shop.
//
// Sources, best first: Pexels when PEXELS_API_KEY is set (curated stock
// photos, best match quality), then Openverse (keyless, openly licensed
// photos), then LoremFlickr (keyless, Flickr photos tagged with the words),
// which needs no lookup and so always answers.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const LOOKUP_TIMEOUT_MS = 6000;
const cache = new Map();

const clampSize = (value, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 16 ? Math.min(n, 2400) : fallback;
};

// "Red Running-Shoes!!" → "red running shoes"; keeps letters in any script.
function cleanQuery(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/[-\s]+/g, " ")
    .trim()
    .slice(0, 80);
}

function orientationOf(width, height) {
  if (width > height * 1.15) return "landscape";
  if (height > width * 1.15) return "portrait";
  return "square";
}

// Stable choice per (query, size, index), so a page that reloads shows the
// same pictures, while two cards asking for "sneakers" can differ by index.
function pick(list, seed) {
  if (!list.length) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchPexels(query, orientation) {
  const key = config.pexelsApiKey || process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${orientation}`;
  const data = await fetchJson(url, { Authorization: key });
  return (data?.photos || [])
    .map((p) => p?.src?.large2x || p?.src?.large || p?.src?.original)
    .filter(Boolean);
}

async function searchOpenverse(query, orientation) {
  const aspect = orientation === "landscape" ? "wide" : orientation === "portrait" ? "tall" : "square";
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20&aspect_ratio=${aspect}&size=medium,large&mature=false`;
  const data = await fetchJson(url, { "User-Agent": "VetroAI/1.0 (site image lookup)" });
  return (data?.results || [])
    // Originals can be huge scans; keep photos a page can load quickly.
    .filter((r) => r?.url && /^https:\/\//.test(r.url) && (!r.width || r.width <= 4000) && (!r.filetype || /jpe?g|png|webp/i.test(r.filetype)))
    .map((r) => r.url);
}

function loremFlickr(query, width, height, seed) {
  const tags = query.split(" ").filter(Boolean).slice(0, 3).join(",") || "abstract";
  let lock = 0;
  for (const ch of seed) lock = (lock * 31 + ch.charCodeAt(0)) % 10000;
  return `https://loremflickr.com/${width}/${height}/${encodeURIComponent(tags)}/all?lock=${lock}`;
}

async function lookup(query, orientation) {
  const key = `${orientation}:${query}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.urls;

  const pending = (async () => {
    for (const [name, search] of [["pexels", searchPexels], ["openverse", searchOpenverse]]) {
      try {
        const urls = await search(query, orientation);
        if (urls.length) return urls;
      } catch (err) {
        logger.warn("siteImage.lookupFailed", { source: name, query, error: err.message });
      }
    }
    return [];
  })();
  // Concurrent requests for the same subject share one lookup.
  cache.set(key, { urls: pending, expires: Date.now() + CACHE_TTL_MS });
  const urls = await pending;
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  // A failed lookup is retried soon rather than cached for a day.
  cache.set(key, { urls, expires: Date.now() + (urls.length ? CACHE_TTL_MS : 5 * 60 * 1000) });
  return urls;
}

/** The URL of a photo of `q`, sized about `w`×`h`. Never throws. */
async function findSiteImage({ q, w, h, i } = {}) {
  const width = clampSize(w, 1200);
  const height = clampSize(h, 800);
  const query = cleanQuery(q) || "abstract background";
  const seed = `${query}|${width}x${height}|${i ?? ""}`;
  const urls = await lookup(query, orientationOf(width, height)).catch(() => []);
  return pick(urls, seed) || loremFlickr(query, width, height, seed);
}

function clearCache() { cache.clear(); }

module.exports = { findSiteImage, cleanQuery, orientationOf, clearCache };
