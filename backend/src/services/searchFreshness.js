// Decides how recent web results need to be for a query.
//
// Every provider used to be asked for "anything, any date", so a question
// like "latest iPhone" or "India vs Australia score" came back ranked purely
// on relevance — which usually means the older, more linked-to pages. This
// reads the query for signs that it is about the present and turns them into
// a time window each provider understands.

const DAY_WORDS = /\b(today|tonight|right now|live|breaking|this morning|this evening|yesterday|scores?|weather|stock price|share price|exchange rate|gold rate|silver rate|petrol price|diesel price)\b/i;
const WEEK_WORDS = /\b(latest|recent|recently|news|headlines|updates?|this week|last week|trending|newest|upcoming|announced|launched|released|election results?|standings|points table|prices?)\b/i;
const MONTH_WORDS = /\b(this month|last month|past month)\b/i;
const YEAR_WORDS = /\b(this year|last year|past year)\b/i;
const NEWS_WORDS = /\b(news|headlines|breaking|latest|today|yesterday|live|scores?|election|announced|launched|updates?)\b/i;

/**
 * @param {string} query
 * @param {Date} [now]
 * @returns {{ recent: boolean, timeRange: "day"|"week"|"month"|"year"|null, topic: "news"|"general" }}
 */
function detectFreshness(query, now = new Date()) {
  const q = String(query || "");
  let timeRange = null;
  if (DAY_WORDS.test(q)) timeRange = "day";
  else if (WEEK_WORDS.test(q)) timeRange = "week";
  else if (MONTH_WORDS.test(q)) timeRange = "month";
  else if (YEAR_WORDS.test(q)) timeRange = "year";

  // Naming the current (or next) year is a strong "I want current info" signal.
  const year = now.getFullYear();
  if (!timeRange && new RegExp(`\\b(${year}|${year + 1})\\b`).test(q)) timeRange = "year";

  return {
    recent: timeRange !== null,
    timeRange,
    topic: NEWS_WORDS.test(q) ? "news" : "general",
  };
}

// Google News understands `when:1d` / `when:7d` / `when:30d` / `when:1y`.
const GOOGLE_NEWS_WHEN = { day: "1d", week: "7d", month: "30d", year: "1y" };
// DuckDuckGo's time filter letters.
const DDG_TIME = { day: "d", week: "w", month: "m", year: "y" };
// Bing's freshness filter: past 24 hours, week, month.
const BING_FRESHNESS = { day: 'ex1:"ez1"', week: 'ex1:"ez2"', month: 'ex1:"ez3"' };

/**
 * Newest first among results that carry a date, keeping undated ones in their
 * original (relevance) order after them. Only used for time-sensitive queries.
 */
function sortByRecency(results) {
  const dated = [];
  const undated = [];
  for (const r of results || []) {
    const t = Date.parse(r?.published_date || r?.publishedDate || r?.published || "");
    if (Number.isNaN(t)) undated.push(r); else dated.push({ r, t });
  }
  dated.sort((a, b) => b.t - a.t);
  return [...dated.map((d) => d.r), ...undated];
}

module.exports = { detectFreshness, sortByRecency, GOOGLE_NEWS_WHEN, DDG_TIME, BING_FRESHNESS };
