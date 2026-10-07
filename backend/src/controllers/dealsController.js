const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const { findDeals, featuredDeals } = require("../services/dealsService");
const { isAllowedImageUrl } = require("../services/productExtras");

// GET /api/deals/search?q=iphone+15&region=in
async function searchDeals(req, res) {
  const query = String(req.query.q || req.query.query || "").trim();
  if (!query) throw new ApiError(400, "Query is required");
  if (query.length > 120) throw new ApiError(400, "Query is too long");
  const data = await findDeals(query, req.query.region);
  return successResponse(res, data.items.length ? "Deals found" : "No priced offers found", data);
}

// GET /api/deals/featured?region=in
async function featured(req, res) {
  return successResponse(res, "Featured deals", await featuredDeals(req.query.region));
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// GET /api/deals/image?u=<store CDN url>
// Fallback for product photos a store's CDN refuses to hotlink. Only the
// store image CDNs in productExtras are fetched, and only images come back.
async function productImage(req, res) {
  const url = String(req.query.u || "");
  if (!isAllowedImageUrl(url)) throw new ApiError(400, "Image host not allowed");
  const upstream = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; VetroAI-Deals/1.0)", "Accept": "image/*" },
  }).catch(() => null);
  const type = upstream?.headers.get("content-type") || "";
  if (!upstream?.ok || !/^image\//i.test(type)) throw new ApiError(502, "Image unavailable");
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new ApiError(502, "Image too large");
  res.set("Content-Type", type);
  res.set("Cache-Control", "public, max-age=86400");
  res.set("X-Content-Type-Options", "nosniff");
  return res.send(buf);
}

module.exports = { searchDeals, featured, productImage };
