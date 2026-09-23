const { fillMissingImages } = require("../services/articleImages");
const ApiError = require("../utils/apiError");
const { config } = require("../config/env");
const {
  detectNewsProvider,
  buildNewsRequest,
  buildNewsAuthFallback,
  normalizeNewsPayload,
  providerLabel,
} = require("../services/newsProviders");

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
    const provider = detectNewsProvider(config.newsDataApiKey, config.newsProvider);
    if (!provider) throw new ApiError(503, "News service is not configured.");

    const query = String(req.query.q || "").trim().slice(0, 100);
    const requested = String(req.query.category || "top").toLowerCase();
    const category = NEWS_CATEGORIES.has(requested) ? requested : "top";
    const language = /^[a-z]{2}$/.test(String(req.query.language || "en"))
      ? String(req.query.language || "en")
      : "en";
    const limit = /^\d{1,3}$/.test(String(config.newsLimit || "")) ? Number(config.newsLimit) : 0;

    const requestParams = {
      apiKey: config.newsDataApiKey,
      query,
      category,
      language,
      limit,
    };
    const request = buildNewsRequest(provider, requestParams);

    let payload;
    try {
      try {
        payload = await fetchJson(request.url, { headers: request.headers });
      } catch (error) {
        // Some services document more than one way to pass the key (Currents
        // has moved between a bare Authorization header, a Bearer one and an
        // `apiKey` parameter). Rather than making the operator work out which
        // their account wants, an unauthorized answer is retried once on the
        // provider's other form.
        const unauthorized = error?.statusCode === 401 || error?.statusCode === 403;
        const fallback = unauthorized ? buildNewsAuthFallback(provider, requestParams, request) : null;
        if (!fallback) throw error;
        payload = await fetchJson(fallback.url, { headers: fallback.headers });
      }
    } catch (error) {
      // The upstream status is the useful part, but its body can carry the key
      // back in an echoed request URL — so only the status and the service name
      // are passed on.
      const status = error?.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
      const reason = status === 401 || status === 403
        ? `${providerLabel(provider)} rejected the configured news API key.`
        : `${providerLabel(provider)} could not be reached (${status}).`;
      throw new ApiError(status === 401 || status === 403 ? 503 : status, reason);
    }

    // Always the newsdata-shaped `results` array the frontend panel renders,
    // whichever service answered.
    const results = normalizeNewsPayload(provider, payload);
    // Articles the feed sent without a picture get the outlet's own preview
    // image (bounded in time, so the feed is never held up for long).
    await fillMissingImages(results);
    return res.json({ results });
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
