const { config } = require("../config/env");
const logger = require("../utils/logger");

// ── Extras for deal offers: long-range price history and product photos ──────
//
// Price history: our own hourly checks only reach back to when tracking began,
// so a "lowest in 3–4 months" verdict would need months of waiting. Keepa
// (KEEPA_API_KEY) has years of Amazon price history and answers immediately
// for any Amazon offer, keyed by its ASIN.
//
// Photos: SerpApi thumbnails are small and web-search offers have none, so
// the product page's own photo (Keepa image, else og:image) is used, and
// known CDN size tokens are bumped to a shop-quality resolution.

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEPA_DOMAINS = { us: 1, in: 10 };
const KEEPA_TTL_MS = 6 * 60 * 60 * 1000;
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
const keepaCache = new Map();   // `${domain}|${asin}` -> { at, value }
const imageCache = new Map();   // product url -> { at, image }
const CACHE_MAX = 3000;

function remember(map, key, value) {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
}

function asinFromUrl(url) {
  const m = String(url || "").match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// Keepa time is minutes since 2011-01-01 UTC.
const keepaTimeToMs = (t) => (t + 21564000) * 60000;

// Turns Keepa's flat [time, price, time, price…] series into points, dropping
// "no offer" (-1) entries. Prices come in the currency's smallest unit.
function keepaSeries(csv) {
  const out = [];
  if (!Array.isArray(csv)) return out;
  for (let i = 0; i + 1 < csv.length; i += 2) {
    const price = csv[i + 1];
    if (typeof price === "number" && price > 0) out.push({ p: price / 100, t: keepaTimeToMs(csv[i]) });
  }
  return out;
}

function keepaImage(product) {
  const first = product?.images?.[0]?.l || String(product?.imagesCSV || "").split(",")[0];
  return first ? `https://m.media-amazon.com/images/I/${first}` : null;
}

// Amazon-sold (csv[0]) and lowest-new third-party (csv[1]) prices, merged —
// the lowest anyone sold it new for at each moment.
function keepaToHistory(product) {
  const points = [...keepaSeries(product?.csv?.[0]), ...keepaSeries(product?.csv?.[1])].sort((a, b) => a.t - b.t);
  return { source: "keepa", points, image: keepaImage(product) };
}

async function fetchKeepa(asins, region) {
  const key = config.keepaApiKey || process.env.KEEPA_API_KEY;
  const domain = KEEPA_DOMAINS[region];
  const result = new Map();
  if (!key || !domain || !asins.length) return result;
  const missing = [];
  for (const asin of asins) {
    const hit = keepaCache.get(`${domain}|${asin}`);
    if (hit && Date.now() - hit.at < KEEPA_TTL_MS) result.set(asin, hit.value);
    else missing.push(asin);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const params = new URLSearchParams({ key, domain: String(domain), asin: batch.join(","), history: "1", days: "180" });
      const res = await fetch(`https://api.keepa.com/product?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Keepa ${res.status}`);
      const body = await res.json();
      for (const product of body.products || []) {
        const value = keepaToHistory(product);
        remember(keepaCache, `${domain}|${product.asin}`, { at: Date.now(), value });
        result.set(product.asin, value);
      }
    } catch (err) {
      logger.warn("deals.keepa.error", { message: err.message, asins: batch.length });
    }
  }
  return result;
}

// Asks CDNs for a larger rendition than a listing thumbnail.
function upgradeImageUrl(url) {
  if (!url) return url;
  let u = String(url);
  // Amazon: ...images/I/71abc._AC_UY218_.jpg -> ._AC_SL1000_.jpg
  u = u.replace(/(\/images\/I\/[^/.]+)\.[^/]*_\.(jpe?g|png|webp)$/i, "$1._AC_SL1000_.$2");
  // Flipkart: rukminim2.flixcart.com/image/312/312/... -> /image/832/832/
  u = u.replace(/(flixcart\.com\/image\/)\d+\/\d+\//i, "$1832/832/");
  // Myntra: h_240,q_90,w_180 -> h_720,q_90,w_540
  u = u.replace(/h_\d+,q_(\d+),w_\d+/i, "h_720,q_$1,w_540");
  return u;
}

function pickMetaImage(html, pageUrl) {
  const patterns = [
    /"hiRes"\s*:\s*"(https:[^"]+)"/i,                                           // Amazon gallery
    /data-old-hires=["'](https:[^"']+)["']/i,                                     // Amazon main image
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try { return new URL(m[1].replace(/&amp;/g, "&"), pageUrl).toString(); } catch { /* malformed */ }
    }
  }
  return null;
}

// Reads the product page's own photo. Cached per page for a day; failures
// (bot walls, timeouts) are cached too so they are not retried every hour.
async function pageImage(url) {
  const hit = imageCache.get(url);
  if (hit && Date.now() - hit.at < IMAGE_TTL_MS) return hit.image;
  let image = null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });
    if (res.ok && /html/i.test(res.headers.get("content-type") || "")) {
      const html = (await res.text()).slice(0, 1_500_000);
      image = pickMetaImage(html, url);
    }
  } catch { /* page unreachable — keep the thumbnail */ }
  remember(imageCache, url, { at: Date.now(), image });
  return image;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

// Adds `externalHistory` (Keepa) and the best available photo to each offer.
// `isStoreUrl` guards page fetches to the region's own store domains.
async function enrichOffers(items, region, isStoreUrl) {
  const asins = [...new Set(items.filter((i) => i.storeId === "amazon").map((i) => asinFromUrl(i.url)).filter(Boolean))];
  const keepa = await fetchKeepa(asins, region);
  const withKeepa = items.map((item) => {
    const asin = item.storeId === "amazon" ? asinFromUrl(item.url) : null;
    const k = asin ? keepa.get(asin) : null;
    if (!k) return item;
    return { ...item, image: k.image || item.image, externalHistory: { source: k.source, points: k.points } };
  });
  return mapLimit(withKeepa, 6, async (item, i) => {
    let image = item.image;
    const thumbOnly = !image || /gstatic\.com|encrypted-tbn/i.test(image);
    if (thumbOnly && i < 24 && isStoreUrl(item.url)) image = (await pageImage(item.url)) || image;
    return { ...item, image: upgradeImageUrl(image) || null };
  });
}

// Photo CDNs the image proxy may fetch from — the proxy is never an open relay.
const IMAGE_HOSTS = [
  "media-amazon.com", "ssl-images-amazon.com", "images-amazon.com",
  "flixcart.com", "croma.com", "reliancedigital.in", "tatacliq.com",
  "myntassets.com", "ajio.com", "meesho.com", "gstatic.com",
  "walmartimages.com", "bbystatic.com", "scene7.com", "ebayimg.com", "neweggimages.com",
];
function isAllowedImageUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

module.exports = {
  enrichOffers, upgradeImageUrl, asinFromUrl, keepaSeries, keepaToHistory, pickMetaImage, isAllowedImageUrl,
  DAY_MS, _keepaCache: keepaCache, _imageCache: imageCache,
};
