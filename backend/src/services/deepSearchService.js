const { searchWeb } = require("../controllers/searchController");
const logger = require("../utils/logger");
const Groq = require("groq-sdk");
const { config } = require("../config/env");

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

async function performDeepSearch(query) {
  logger.info("deepSearch.started", { query });
  
  // 1. Generate multiple specific queries using an LLM for better search coverage
  let queries = [query];
  
  if (groq) {
    try {
      const prompt = `You are a search expert. Generate 3 specific, effective Google search queries to thoroughly answer this user question: "${query}".
The current date is May 9, 2026. If the query is about a recent event, ensure the search queries target the latest 2026 data and actual results, not older predictions.
Respond ONLY with the queries, one per line. Do not add numbering, bullets, or quotes.`;
      
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-8b-instant",
        temperature: 0.1,
        max_tokens: 100,
      });
      
      const text = completion.choices[0]?.message?.content || "";
      const generatedQueries = text.split("\n")
        .map(q => q.trim().replace(/^[\d\.\-\"\']+|[\"\']+$/g, '').trim())
        .filter(q => q.length > 3);
        
      if (generatedQueries.length > 0) {
        queries = generatedQueries;
        logger.info("deepSearch.llmQueries", { queries });
      }
    } catch (e) {
      logger.error("deepSearch.queryGen.failed", { error: e.message });
    }
  }

  const allResults = [];
  const allSnippets = [];

  for (const q of queries) {
    try {
      const { context, results } = await searchWeb(q);
      allResults.push(...results);
      allSnippets.push(context);
    } catch (err) {
      logger.error("deepSearch.query.failed", { query: q, error: err.message });
    }
  }

  // Deduplicate results based on URL
  const seenUrls = new Set();
  const uniqueResults = [];
  for (const r of allResults) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      uniqueResults.push(r);
    }
  }

  // Combine contexts
  const combinedContext = allSnippets.join("\n\n---\n\n");

  return {
    context: combinedContext,
    results: uniqueResults,
  };
}

module.exports = { performDeepSearch };
