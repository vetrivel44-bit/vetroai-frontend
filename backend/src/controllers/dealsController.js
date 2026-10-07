const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const { findDeals, featuredDeals } = require("../services/dealsService");

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

module.exports = { searchDeals, featured };
