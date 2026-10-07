const { config } = require("../config/env");
const logger = require("../utils/logger");

// ── Canopy API (canopyapi.co) — live Amazon product data ────────────────────
// REST, authenticated with an API-KEY header:
//   GET /api/amazon/search?searchTerm=…&domain=…  → data.amazonProductSearchResults.productResults.results[]
//   GET /api/amazon/product?asin=…&domain=…       → data.amazonProduct
// Each result carries Amazon's own price, rating and original product photos
// (mainImageUrl / imageUrls), so Amazon offers come straight from Amazon's
// catalogue instead of being read out of search snippets.

const BASE = "https://rest.canopyapi.co/api/amazon";
const PRODUCT_TTL_MS = 6 * 60 * 60 * 1000;
const productCache = new Map(); // `${domain}|${asin}` -> { at, value }

const apiKey = () => config.canopyApiKey || process.env.CANOPY_API_KEY || "";
const domainFor = (region) => (region === "us" ? config.canopyDomainUs : config.canopyDomainIn) || (region === "us" ? "US" : "IN");
const amazonHost = (region) => (region === "us" ? "www.amazon.com" : "www.amazon.in");

async function canopyGet(path, params) {
  const res = await fetch(`${BASE}/${path}?${new URLSearchParams(params)}`, {
    headers: { "API-KEY": apiKey(), Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Canopy ${path} ${res.status}`);
  const body = await res.json();
  // REST answers mirror the GraphQL shape: { data: { … } }
  return body?.data || body;
}

function priceValue(price) {
  if (price == null) return null;
  if (typeof price === "number") return price > 0 ? price : null;
  const v = typeof price.value === "number" ? price.value : Number(String(price.value ?? price.display ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function photosOf(p) {
  return [...new Set([p?.mainImageUrl, ...(Array.isArray(p?.imageUrls) ? p.imageUrls : [])].filter((u) => typeof u === "string" && u.startsWith("http")))];
}

function productUrl(p, region) {
  if (typeof p?.url === "string" && /^https?:\/\//.test(p.url)) return p.url;
  return p?.asin ? `https://${amazonHost(region)}/dp/${p.asin}` : null;
}

// Amazon search → offers in the Deals item shape. Sponsored placements are
// ads, not the cheapest listing, so they are left out.
async function searchAmazon(query, region, store) {
  if (!apiKey()) return [];
  try {
    const data = await canopyGet("search", { searchTerm: query, domain: domainFor(region) });
    const results = data?.amazonProductSearchResults?.productResults?.results || [];
    return results
      .filter((p) => !p.sponsored)
      .map((p) => {
        const photos = photosOf(p);
        return {
          title: String(p.title || "").slice(0, 160),
          price: priceValue(p.price),
          originalPrice: priceValue(p.listPrice || p.wasPrice || p.originalPrice) || null,
          store: store.name,
          storeId: store.id,
          storeColor: store.color,
          url: productUrl(p, region),
          image: photos[0] || null,
          images: photos,
          rating: typeof p.rating === "number" ? p.rating : null,
          reviews: typeof p.ratingsTotal === "number" ? p.ratingsTotal : null,
          delivery: p.isPrime ? "Prime delivery" : null,
          asin: p.asin || null,
          source: "canopy",
        };
      })
      .filter((i) => i.title && i.price && i.url);
  } catch (err) {
    logger.warn("deals.canopy.search_failed", { query, message: err.message });
    return [];
  }
}

// One Amazon product by ASIN — used for the original photos of Amazon offers
// that came from another source. Cached for a few hours.
async function amazonProduct(asin, region) {
  if (!apiKey() || !asin) return null;
  const domain = domainFor(region);
  const key = `${domain}|${asin}`;
  const hit = productCache.get(key);
  if (hit && Date.now() - hit.at < PRODUCT_TTL_MS) return hit.value;
  let value = null;
  try {
    const data = await canopyGet("product", { asin, domain });
    const p = data?.amazonProduct;
    if (p) value = { photos: photosOf(p), price: priceValue(p.price), rating: typeof p.rating === "number" ? p.rating : null, reviews: typeof p.ratingsTotal === "number" ? p.ratingsTotal : null };
  } catch (err) {
    logger.warn("deals.canopy.product_failed", { asin, message: err.message });
  }
  if (productCache.size >= 2000) productCache.delete(productCache.keys().next().value);
  productCache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { searchAmazon, amazonProduct, priceValue, photosOf, isConfigured: () => Boolean(apiKey()), _productCache: productCache };
