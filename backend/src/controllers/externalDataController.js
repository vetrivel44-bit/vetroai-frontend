const { fillMissingImages, findArticleImage } = require("../services/articleImages");
const ApiError = require("../utils/apiError");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const {
  detectNewsProvider,
  buildNewsRequest,
  buildNewsAuthFallback,
  normalizeNewsPayload,
  nextNewsPage,
  sortNewestFirst,
  dedupeArticles,
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

// Fetches one page from one news service, trying the provider's other auth
// form once on a 401/403. Throws an ApiError that never echoes the key.
async function fetchNewsPage(provider, requestParams) {
  const request = buildNewsRequest(provider, requestParams);
  try {
    try {
      return await fetchJson(request.url, { method: request.method, headers: request.headers, body: request.body });
    } catch (error) {
      // Some services document more than one way to pass the key (Currents
      // has moved between a bare Authorization header, a Bearer one and an
      // `apiKey` parameter). Rather than making the operator work out which
      // their account wants, an unauthorized answer is retried once on the
      // provider's other form.
      const unauthorized = error?.statusCode === 401 || error?.statusCode === 403;
      const fallback = unauthorized ? buildNewsAuthFallback(provider, requestParams, request) : null;
      if (!fallback) throw error;
      return await fetchJson(fallback.url, { headers: fallback.headers });
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
}

// Firecrawl's page cursors are tagged so a page fetched from the fallback is
// continued from the fallback, not handed to the news API as its own cursor.
const FIRECRAWL_PAGE_TAG = "fc_";

// Which services serve the feed, in order. The news API (NEWS_API_KEY) is a
// real-time feed sorted by publish time, so it comes first; Firecrawl's news
// search ranks by relevance (stories hours old at the top), so it is only the
// fallback — unless NEWS_PROVIDER=firecrawl asks for it outright.
function newsProviderChain() {
  const chain = [];
  const forceFirecrawl = String(config.newsProvider || "").trim().toLowerCase() === "firecrawl";
  if (config.newsDataApiKey && !forceFirecrawl) {
    const provider = detectNewsProvider(config.newsDataApiKey, config.newsProvider);
    if (provider && provider !== "firecrawl") chain.push({ provider, apiKey: config.newsDataApiKey });
  }
  const firecrawlKey = config.firecrawlApiKey || (detectNewsProvider(config.newsDataApiKey) === "firecrawl" ? config.newsDataApiKey : "");
  if (firecrawlKey) chain.push({ provider: "firecrawl", apiKey: firecrawlKey });
  return chain;
}

async function latestNews(req, res, next) {
  try {
    let chain = newsProviderChain();
    if (!chain.length) throw new ApiError(503, "News service is not configured.");

    const query = String(req.query.q || "").trim().slice(0, 100);
    const requested = String(req.query.category || "top").toLowerCase();
    const category = NEWS_CATEGORIES.has(requested) ? requested : "top";
    const language = /^[a-z]{2}$/.test(String(req.query.language || "en"))
      ? String(req.query.language || "en")
      : "en";
    const limit = /^\d{1,3}$/.test(String(config.newsLimit || "")) ? Number(config.newsLimit) : 0;
    // Page cursor from the previous response's `nextPage` (opaque for
    // newsdata, a number for the others, `fc_N` for the Firecrawl fallback).
    const rawPage = String(req.query.page || "").trim();
    let page = /^[A-Za-z0-9_-]{1,80}$/.test(rawPage) ? rawPage : "";
    if (page.startsWith(FIRECRAWL_PAGE_TAG)) {
      chain = chain.filter((entry) => entry.provider === "firecrawl");
      page = page.slice(FIRECRAWL_PAGE_TAG.length);
      if (!chain.length) throw new ApiError(400, "Invalid page cursor.");
    }

    let provider;
    let payload;
    let lastError;
    for (const entry of chain) {
      try {
        payload = await fetchNewsPage(entry.provider, { apiKey: entry.apiKey, query, category, language, limit, page });
        provider = entry.provider;
        break;
      } catch (error) {
        lastError = error;
        logger.warn("news.providerFailed", { provider: entry.provider, status: error.statusCode, message: error.message });
        // A cursor belongs to the service that issued it; the next service
        // starts from its own first page.
        page = "";
      }
    }
    if (!provider) throw lastError;

    // Always the newsdata-shaped `results` array the frontend panel renders,
    // whichever service answered.
    const results = dedupeArticles(sortNewestFirst(normalizeNewsPayload(provider, payload, page)));
    // Articles the feed sent without a picture get the outlet's own preview
    // image (bounded in time, so the feed is never held up for long).
    await fillMissingImages(results);
    // A story whose full-size photo wasn't found in time shows the search
    // thumbnail for now; `low_res` tells the card to keep asking for the
    // article's own photo and swap it in.
    for (const article of results) {
      if (!article.image_url && article.thumbnail_url) {
        article.image_url = article.thumbnail_url;
        article.low_res = true;
      }
      delete article.thumbnail_url;
    }
    const nextPage = nextNewsPage(provider, payload, page);
    // News goes stale in minutes — never let a browser or CDN reuse a copy.
    res.set("Cache-Control", "no-store, max-age=0");
    return res.json({ results, nextPage: nextPage && provider === "firecrawl" ? `${FIRECRAWL_PAGE_TAG}${nextPage}` : nextPage });
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

// One story's preview photo, for cards whose image the feed-wide fill didn't
// reach in time. Only ever returns an image URL — never the page itself — and
// findArticleImage refuses non-public hosts.
async function newsPreviewImage(req, res, next) {
  try {
    const url = String(req.query.url || "").trim();
    if (!/^https?:\/\//i.test(url) || url.length > 2048) throw new ApiError(400, "A valid article URL is required.");
    const image = await findArticleImage(url);
    res.set("Cache-Control", "public, max-age=21600");
    return res.json({ image_url: image });
  } catch (error) {
    return next(error);
  }
}

module.exports = { latestNews, footballFixtures, newsPreviewImage };
