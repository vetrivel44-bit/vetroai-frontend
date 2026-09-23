const { tavily } = require("@tavily/core");
const { search } = require("duck-duck-scrape");
const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");

// ── Primary: Tavily (best real-time AI search) ────────────────────────────────
async function searchTavily(query) {
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const client = tavily({ apiKey });
    const res = await Promise.race([
      client.search(query, {
        searchDepth: "basic",
        maxResults: 8,
        includeAnswer: true,
        includeRawContent: false,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tavily timeout")), 8000)),
    ]);

    return res;
  } catch (err) {
    logger.warn("Tavily search failed", { error: err.message });
    return null;
  }
}

// ── Fallback: DuckDuckGo ──────────────────────────────────────────────────────
async function searchDDG(query) {
  try {
    const res = await Promise.race([
      search(query, { safeSearch: 0 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DDG timeout")), 7000)),
    ]);
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

// ── Keyless fallbacks: Bing and Google News RSS ────────────────────────────
// DuckDuckGo often refuses requests from cloud hosts (Render included), so
// when Tavily is down or out of credits a search could come back empty and
// the answer went out with no live data. These two RSS feeds need no key and
// answer from datacenter IPs.
const decodeXml = (text = "") => String(text)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  // Entities first: descriptions carry escaped HTML (&lt;b&gt;) whose tags
  // must be stripped too.
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function parseRssItems(xml, limit = 8) {
  const items = [];
  for (const block of String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const tag = (name) => decodeXml((block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\/${name}>`, "i")) || [])[1] || "");
    const url = tag("link");
    const title = tag("title");
    if (!/^https?:\/\//i.test(url) || !title) continue;
    const date = Date.parse(tag("pubDate"));
    items.push({
      title,
      description: tag("description").slice(0, 400),
      url,
      published: Number.isNaN(date) ? null : new Date(date).toISOString(),
      source: tag("source") || null,
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchRss(url, label) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VetroAI-Search/1.0)", Accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRssItems(await res.text());
  } catch (err) {
    logger.warn(`${label} search failed`, { error: err.message });
    return [];
  }
}

const searchBingRss = (query) => fetchRss(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, "Bing RSS");
const searchGoogleNewsRss = (query) => fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`, "Google News RSS");

// Keyless search: DuckDuckGo, then Bing, then Google News — first non-empty wins.
async function searchKeyless(query) {
  for (const [name, run] of [["duckduckgo", searchDDG], ["bing", searchBingRss], ["google-news", searchGoogleNewsRss]]) {
    const results = await run(query);
    if (results.length) return { provider: name, results };
  }
  return { provider: null, results: [] };
}

// ── Image search (Tavily only — DDG fallback has no reliable image API) ───────
async function searchImages(query, limit = 4) {
  const apiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (!apiKey || !query) return [];

  try {
    const client = tavily({ apiKey });
    const res = await Promise.race([
      client.search(query, {
        searchDepth: "basic",
        maxResults: 1,
        includeImages: true,
        includeImageDescriptions: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tavily image search timeout")), 8000)),
    ]);

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

  // ── Fallback: keyless search (DuckDuckGo → Bing → Google News) ───────────
  logger.info("Tavily unavailable, falling back to keyless search...");
  const { results } = await searchKeyless(query);

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
    const { context } = await Promise.race([
      searchWeb(query),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Search timed out")), 12000)),
    ]);
    return successResponse(res, "Search successful", { context });
  } catch (error) {
    logger.error("searchController.error", { message: error.message });
    throw new ApiError(500, "Web search failed");
  }
}

module.exports = { performSearch, searchWeb, searchImages, searchTavily, searchDDG, searchKeyless, parseRssItems };
