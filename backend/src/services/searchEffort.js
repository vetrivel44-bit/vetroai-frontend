// How hard a web search works, by the effort the user picked (Quick,
// Balanced, Deep, Max). Search used to run the same fixed 8 basic results for
// every effort, so Deep and Max only changed how long the model thought, not
// how much it looked up.
//
// web:      the normal search in Web Search / auto-search.
//   depth        Tavily search depth ("advanced" reads pages more thoroughly)
//   maxResults   results asked for
//   fullPages    results whose page text goes to the model
//   pageChars    how much of each of those pages
//   readPages    keyless fallback only (snippets): top pages read directly
//   timeoutMs    the whole search's time budget
// research: DeepSearch (agenticSearchService options; balanced = its defaults).
const PROFILES = {
  quick: {
    web: { depth: "basic", maxResults: 5, fullPages: 1, pageChars: 2000, readPages: 0, timeoutMs: 10000 },
    research: { maxAngles: 3, maxRounds: 1, maxQueries: 10, followUpQueries: 2, verifyClaims: 1, readPages: 5, maxSources: 12, contextChars: 26000, searchDepth: "basic", resultsPerQuery: 5 },
  },
  balanced: {
    web: { depth: "basic", maxResults: 8, fullPages: 3, pageChars: 3000, readPages: 0, timeoutMs: 10000 },
    research: { searchDepth: "basic", resultsPerQuery: 6 },
  },
  deep: {
    web: { depth: "advanced", maxResults: 10, fullPages: 5, pageChars: 4000, readPages: 3, timeoutMs: 16000 },
    research: { maxAngles: 6, maxRounds: 3, maxQueries: 32, followUpQueries: 5, verifyClaims: 6, readPages: 16, maxSources: 30, contextChars: 50000, searchDepth: "advanced", resultsPerQuery: 7 },
  },
  max: {
    web: { depth: "advanced", maxResults: 12, fullPages: 6, pageChars: 5000, readPages: 4, timeoutMs: 18000 },
    research: { maxAngles: 7, maxRounds: 4, maxQueries: 40, followUpQueries: 6, verifyClaims: 8, readPages: 20, maxSources: 36, contextChars: 56000, searchDepth: "advanced", resultsPerQuery: 8 },
  },
};

const normalizeEffort = (effort) => (Object.prototype.hasOwnProperty.call(PROFILES, effort) ? effort : "balanced");

/** The normal web search's settings for an effort. */
const webSearchProfile = (effort) => ({ effort: normalizeEffort(effort), ...PROFILES[normalizeEffort(effort)].web });

/** DeepSearch's options for an effort. */
const researchProfile = (effort) => ({ ...PROFILES[normalizeEffort(effort)].research });

module.exports = { normalizeEffort, webSearchProfile, researchProfile, SEARCH_EFFORT_PROFILES: PROFILES };
