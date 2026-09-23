const { tavily } = require("@tavily/core");
const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { searchKeyless } = require("./searchController");

function normalizeResults(results) {
  return (results || []).slice(0, 10).map((r) => ({
    title: r.title || "(untitled)",
    url: r.url || "",
    snippet: r.snippet || r.description || (typeof r.content === "string" ? r.content.slice(0, 300) : "") || "",
    published: r.published_date || r.publishedDate || r.published || null,
    score: typeof r.score === "number" ? Number(r.score.toFixed(3)) : null,
  }));
}

// ── Search for the Web Search mode / modal ──────────────────────────────────
// Tavily first ("advanced" depth: richer snippets, plus its own AI summary).
// When Tavily isn't configured, is out of credits or fails, the keyless chain
// (DuckDuckGo → Bing → Google News) answers instead — previously this returned
// an error and web search silently stopped working.
async function performStructuredSearch(req, res) {
  const raw = req.body?.query || req.query?.query;
  const query = String(raw || "").trim();
  if (!query) throw new ApiError(400, "Query is required");

  const started = Date.now();
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (apiKey) {
    try {
      const client = tavily({ apiKey });
      const tavilyRes = await Promise.race([
        client.search(query, {
          searchDepth: "advanced",   // richer content, better relevance
          maxResults: 10,
          includeAnswer: "advanced", // comprehensive, reasonable depth AI synthesis
          includeRawContent: false,
          includeImages: false,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Tavily search timed out")), 12000)
        ),
      ]);
      if (tavilyRes?.results?.length || tavilyRes?.answer) {
        return successResponse(res, "Search successful", {
          provider: "tavily",
          query,
          answer: tavilyRes.answer || "",
          results: normalizeResults(tavilyRes.results),
          tookMs: Date.now() - started,
        });
      }
    } catch (err) {
      logger.warn("web-search.tavily.error", { query, message: err.message });
    }
  }

  const fallback = await searchKeyless(query);
  if (!fallback.results.length) {
    throw new ApiError(502, "Web search is unavailable right now — no search provider returned results.");
  }
  return successResponse(res, "Search successful", {
    provider: fallback.provider,
    query,
    answer: "",
    results: normalizeResults(fallback.results),
    tookMs: Date.now() - started,
  });
}

// Optional companion endpoint: image results for the same query (Tavily only).
async function performStructuredImageSearch(req, res) {
  const raw = req.body?.query || req.query?.query;
  const query = String(raw || "").trim();
  if (!query) throw new ApiError(400, "Query is required");

  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) throw new ApiError(503, "Tavily API key not configured");

  const started = Date.now();
  try {
    const client = tavily({ apiKey });
    const res2 = await Promise.race([
      client.search(query, {
        searchDepth: "basic",
        maxResults: 1,
        includeImages: true,
        includeImageDescriptions: true,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Tavily image search timeout")), 8000)
      ),
    ]);

    const images = (res2?.images || [])
      .slice(0, 8)
      .map((img) => ({ url: img.url, caption: img.description || query }));

    return successResponse(res, "Image search successful", {
      provider: "tavily",
      query,
      images,
      tookMs: Date.now() - started,
    });
  } catch (err) {
    logger.error("web-search.image.error", { message: err.message });
    throw new ApiError(502, "Image search failed. Please try again.");
  }
}

module.exports = { performStructuredSearch, performStructuredImageSearch };