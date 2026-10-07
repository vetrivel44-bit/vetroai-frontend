const { config } = require("../config/env");

// ── Real-Time Product Search (RapidAPI, by letscrape / OpenWeb Ninja) ───────
// Google Shopping data across stores (Amazon, Flipkart, Croma, Walmart…) with
// each product's original photos and its best current offer. One RapidAPI key
// (PRODUCT_SEARCH_RAPIDAPI_KEY, or the generic RAPIDAPI_KEY) covers every store.
//
//   GET https://{host}/search-v2?q=…&country=in&language=en&limit=…   (falls back to /search)
//   headers: X-RapidAPI-Key, X-RapidAPI-Host
//
// The API has answered as both { data: [product…] } and
// { data: { products: [product…] } }; both are accepted. Each product has
// product_title, product_photos[], product_rating, product_num_reviews,
// product_page_url and offer { price, original_price, store_name, offer_page_url }.

const apiKey = () => config.productSearchRapidApiKey || process.env.PRODUCT_SEARCH_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY || "";
const apiHost = () => config.productSearchRapidApiHost || "real-time-product-search.p.rapidapi.com";

// "₹1,29,999.00", "$249.99", "Rs. 999", 1299 → number
function parsePrice(value) {
  if (typeof value === "number") return value > 0 ? value : null;
  const m = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function productsOf(body) {
  const d = body?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.products)) return d.products;
  return [];
}

async function callSearch(path, params) {
  const res = await fetch(`https://${apiHost()}/${path}?${new URLSearchParams(params)}`, {
    headers: { "X-RapidAPI-Key": apiKey(), "X-RapidAPI-Host": apiHost(), Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null; // endpoint not on this API version
  if (!res.ok) throw new Error(`Product search ${path} ${res.status}`);
  return res.json();
}

// Offers for a query, in the Deals item shape. `storeFor(name, url)` maps the
// merchant to one of the region's stores (or null for any other merchant).
async function searchProducts(query, region, storeFor) {
  if (!apiKey()) return null;
  const params = { q: query, country: region === "us" ? "us" : "in", language: "en", page: "1", limit: "30", sort_by: "BEST_MATCH", product_condition: "NEW" };
  let body = await callSearch("search-v2", params);
  if (!body) body = await callSearch("search", params);
  const items = [];
  for (const p of productsOf(body)) {
    const offer = p.offer || p.offers?.[0] || {};
    const price = parsePrice(offer.price ?? p.price);
    const url = offer.offer_page_url || p.product_page_url || p.product_offers_page_url;
    if (!price || !url) continue;
    const storeName = offer.store_name || p.store_name || "";
    const store = storeFor(storeName, url);
    const photos = (Array.isArray(p.product_photos) ? p.product_photos : []).filter((u) => typeof u === "string" && u.startsWith("http"));
    const original = parsePrice(offer.original_price);
    items.push({
      title: String(p.product_title || offer.offer_title || "").slice(0, 160),
      price,
      originalPrice: original && original > price ? original : null,
      store: store?.name || storeName || "Store",
      storeId: store?.id || String(storeName || "store").toLowerCase().replace(/[^a-z0-9]/g, "") || "store",
      storeColor: store?.color || null,
      url,
      image: photos[0] || null,
      images: photos.slice(0, 4),
      rating: typeof p.product_rating === "number" ? p.product_rating : null,
      reviews: typeof p.product_num_reviews === "number" ? p.product_num_reviews : null,
      delivery: typeof offer.shipping === "string" ? offer.shipping : null,
      source: "product-search",
    });
  }
  return items.filter((i) => i.title);
}

function isConfigured() { return Boolean(apiKey()); }

module.exports = { searchProducts, parsePrice, productsOf, isConfigured };
