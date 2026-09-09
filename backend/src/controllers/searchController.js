const { tavily } = require("@tavily/core");
const { search } = require("duck-duck-scrape");
const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { withTimeout } = require("../utils/withTimeout");

// ── Primary: Tavily (best real-time AI search) ────────────────────────────────
async function searchTavily(query) {
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const client = tavily({ apiKey });
    const res = await withTimeout(
      client.search(query, {
        searchDepth: "basic",
        maxResults: 8,
        includeAnswer: true,
        includeRawContent: false,
      }),
      8000,
      "Tavily timeout"
    );

    return res;
  } catch (err) {
    logger.warn("Tavily search failed", { error: err.message });
    return null;
  }
}

// ── Fallback: DuckDuckGo ──────────────────────────────────────────────────────
async function searchDDG(query) {
  try {
    const res = await withTimeout(
      search(query, { safeSearch: 0 }),
      7000,
      "DDG timeout"
    );
    if (!res?.results?.length) return [];
    return res.results.slice(0, 8).map(r => ({
      title: r.title,
      description: r.description || "",
      url: r.url,
    }));
  } catch (err) {
    logger.warn("DDG search failed", { error: err.message });
    return [];
  }
}

// ── Image search (Tavily only — DDG fallback has no reliable image API) ───────
async function searchImages(query, limit = 4) {
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey || !query) return [];

  try {
    const client = tavily({ apiKey });
    const res = await withTimeout(
      client.search(query, {
        searchDepth: "basic",
        maxResults: 1,
        includeImages: true,
        includeImageDescriptions: true,
      }),
      8000,
      "Tavily image search timeout"
    );

    return (res?.images || [])
      .slice(0, limit)
      .map((img) => ({ url: img.url, caption: img.description || query }));
  } catch (err) {
    logger.warn("Tavily image search failed", { error: err.message });
    return [];
  }
}

async function searchWeb(query) {
  if (!query) throw new Error("Query is required");

  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const snippets = [];
  snippets.push(`**Search Date**: ${todayStr} | **Query**: "${query}"`);

  // ── Try Tavily first ──────────────────────────────────────────────────────
  const tavilyRes = await searchTavily(query);

  if (tavilyRes) {
    // Tavily provides a direct AI answer
    if (tavilyRes.answer) {
      snippets.push(`**Quick Answer**: ${tavilyRes.answer}`);
    }

    if (tavilyRes.results?.length) {
      const orgText = tavilyRes.results.map((r, i) =>
        `[${i + 1}] **${r.title}**\n${r.snippet || r.content?.slice(0, 300) || "(no snippet)"}\n${r.url}`
      ).join("\n\n");
      snippets.push(`**Web Results for "${query}"**:\n\n${orgText}`);

      // Include raw content from top results if available
      const fullContent = tavilyRes.results
        .slice(0, 3)
        .filter(r => r.content && r.content.length > 200)
        .map((r, i) => `**Full Content [${i + 1}] — "${r.title}"**:\n${r.content.slice(0, 3000)}`);
      fullContent.forEach(c => snippets.push(c));
    }

    return { context: snippets.join("\n\n---\n\n"), results: tavilyRes.results || [] };
  }

  // ── Fallback: DuckDuckGo ──────────────────────────────────────────────────
  logger.info("Tavily unavailable, falling back to DDG...");
  const results = await searchDDG(query);

  if (results.length === 0) {
    snippets.push(`No live web results found. Answer based on training knowledge and note the info may not be real-time.`);
    return { context: snippets.join("\n\n"), results: [] };
  }

  const orgText = results.map((r, i) =>
    `[${i + 1}] **${r.title}**\n${r.description || "(no snippet)"}\n${r.url}`
  ).join("\n\n");
  snippets.push(`**Web Results for "${query}"**:\n\n${orgText}`);

  return { context: snippets.join("\n\n---\n\n"), results };
}

async function performSearch(req, res) {
  const query = req.body?.query;
  if (!query) throw new ApiError(400, "Query is required");
  try {
    const { context } = await withTimeout(
      searchWeb(query),
      12000,
      "Search timed out"
    );
    return successResponse(res, "Search successful", { context });
  } catch (error) {
    logger.error("searchController.error", { message: error.message });
    throw new ApiError(500, "Web search failed");
  }
}

module.exports = { performSearch, searchWeb, searchImages };
