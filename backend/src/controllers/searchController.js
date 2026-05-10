const { search } = require("duck-duck-scrape");
const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");

async function fetchPageContent(url, maxChars = 3000) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Strip excessive whitespace and return useful portion
    return text.replace(/\s{3,}/g, "\n\n").trim().slice(0, maxChars) || null;
  } catch (err) {
    return null;
  }
}

const cheerio = require("cheerio");

async function searchWeb(query) {
  if (!query) throw new Error("Query is required");

  // 1. Manually scrape DuckDuckGo HTML to avoid library rate limits
  const fetchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    },
    signal: AbortSignal.timeout(8000)
  });
  
  if (!fetchRes.ok) throw new Error(`DDG returned ${fetchRes.status}`);
  const html = await fetchRes.text();
  const $ = cheerio.load(html);
  
  const results = [];
  $('.result').each((i, el) => {
    if (results.length >= 5) return;
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    let url = $(el).find('.result__url').attr('href');
    if (title && url) {
      if (url.includes('uddg=')) {
        try { url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]); } catch (e) {}
      }
      results.push({ title, description: snippet, url });
    }
  });

  const snippets = [];
  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  snippets.push(`**Search Date**: ${todayStr} | **Query**: "${query}"`);

  if (results.length === 0) {
    return { context: snippets.join("\n\n"), results: [] };
  }

  // Add organic results
  const orgText = results.map((r, i) =>
    `[${i + 1}] **${r.title}**\n${r.description || "(no snippet)"}\n${r.url}`
  ).join("\n\n");
  snippets.push(`**Web Results for "${query}"**:\n\n${orgText}`);

  // Try to fetch actual content from the top 3 results in parallel
  const contentPromises = results.slice(0, 3).map(async (r, i) => {
    if (r.url && !r.url.includes("youtube.com") && !r.url.includes("twitter.com")) {
      const pageContent = await fetchPageContent(r.url);
      if (pageContent && pageContent.length > 200) {
        return `**Full Content [${i + 1}] — "${r.title}"**:\n${pageContent}`;
      }
    }
    return null;
  });

  const pageContents = await Promise.all(contentPromises);
  pageContents.filter(Boolean).forEach(content => snippets.push(content));

  return { context: snippets.join("\n\n---\n\n"), results };
}

async function performSearch(req, res) {
  const query = req.body?.query;
  if (!query) throw new ApiError(400, "Query is required");

  try {
    const { context } = await searchWeb(query);
    return successResponse(res, "Search successful", { context });
  } catch (error) {
    logger.error("searchController.error", { message: error.message });
    throw new ApiError(500, "Web search failed");
  }
}

module.exports = { performSearch, searchWeb };
