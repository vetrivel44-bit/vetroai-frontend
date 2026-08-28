const ApiError = require("../utils/apiError");
const { config } = require("../config/env");

const NEWS_CATEGORIES = new Set([
  "top", "business", "technology", "sports", "entertainment", "health", "science", "politics",
]);

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(response.status, payload?.message || `Upstream service returned ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function latestNews(req, res, next) {
  try {
    if (!config.newsDataApiKey) throw new ApiError(503, "News service is not configured.");
    const query = String(req.query.q || "").trim().slice(0, 100);
    const category = String(req.query.category || "top").toLowerCase();
    const language = /^[a-z]{2}$/.test(String(req.query.language || "en"))
      ? String(req.query.language || "en")
      : "en";

    const params = new URLSearchParams({ apikey: config.newsDataApiKey, language });
    if (query) params.set("q", query);
    else if (category !== "top" && NEWS_CATEGORIES.has(category)) params.set("category", category);

    const data = await fetchJson(`https://newsdata.io/api/1/latest?${params}`);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function footballFixtures(req, res, next) {
  try {
    if (!config.apiSportsKey) throw new ApiError(503, "Football service is not configured.");
    const scope = req.query.scope === "live" ? "live" : "today";
    const params = new URLSearchParams();
    if (scope === "live") params.set("live", "all");
    else params.set("date", new Date().toISOString().slice(0, 10));

    const data = await fetchJson(`https://v3.football.api-sports.io/fixtures?${params}`, {
      headers: { "x-apisports-key": config.apiSportsKey },
    });
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = { latestNews, footballFixtures };
