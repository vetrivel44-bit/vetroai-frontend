// Does a question need live information from the web?
//
// The models' own knowledge stops at their training date. The auto-search
// setting used to search only when one of LIVE_INFO_PATTERNS matched, so a
// question without a word like "2026", "latest" or "news" — "best phones
// under 30000", "tamil nadu cm", "zephyr x9 review" — was answered from that
// out-of-date memory. The rule is now the other way round: with auto-search
// on, a question is searched unless it is clearly timeless (code, maths,
// writing or translating, explaining a concept, something about this chat,
// small talk). In the modes made for those (coding, creative, design…) only
// the clearly-current patterns search.
//
// "Is TTV Vasan in Bigg Boss season 10?" once got a confident, out-of-date and
// partly invented answer because no pattern covered TV shows, public roles or
// "is X in …" questions; the patterns below still decide those at once.
//
// frontend/src/lib/liveInfoIntent.js carries the same rules for browser
// models; keep the two in step (a test compares them).

const LIVE_INFO_PATTERNS = [
  // Time words
  /\b(today|tonight|tomorrow|yesterday|now|current|currently|live|latest|recent|recently|breaking|news|update|updates)\b/i,
  /\b(20[2-9]\d|this (year|month|week|weekend|season)|last (week|month|night)|next (week|month|year|match|season|episode))\b/i,
  // Who holds / did what now
  /\bwho (is|are|was|were|won|leads|runs|hosts|plays|joined|left|replaced)\b/i,
  /\bwhat is the (score|price|rate|status|result)\b/i,
  // Markets, weather, sport, conflict
  /\b(stock|share price|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket|football|tournament|world cup|olympics)\b/i,
  /\bjust (happened|announced|released|launched)\b/i,
  /\b(trending|viral|happening)\b/i,
  // Shows, films and releases
  /\b(bigg ?boss|season \d+|s\d{1,2}e\d{1,2}|episodes?|contestants?|housemates?|evict(ed|ion)|eliminat(ed|ion)|finalists?|wild ?card|hosted by|cast of|box office|collections?|release date|released|trailer|ott|netflix|prime video|hotstar|jiohotstar|zee5|sun nxt)\b/i,
  // People in public roles
  /\b(chief minister|prime minister|minister|governor|president of|mla|mp|mayor|ceo of|captain of|coach of|political party|party (leader|president|chief)|alliance|elected|appointed|resigned|sworn in|arrested|passed away)\b/i,
  // "Is X in / still / currently …", "Did X win …"
  /^\s*(is|are|was|were|did|does|has|have|will)\b.{2,80}\b(in|on|still|currently|now|joining|participating|playing|contesting|alive|married|retired|winner|won|win)\b/i,
  /\b(when (is|will|does|did)|upcoming|schedule|fixtures?|results?|winners?|price of|cost of|how much (is|does))\b/i,
  // AI models, gadgets and products: new ones (and codenames) keep arriving
  // after training, so "tell about gemini argon" got "I'm not aware of it"
  /\b(gemini|gpt[- ]?\d[\w.]*|chatgpt|openai|claude|anthropic|llama|grok|deepseek|qwen|mistral|copilot|sora|veo|midjourney|perplexity|iphone|pixel \d+|galaxy [sza]\d+|ios \d+|android \d+|rtx ?\d+|playstation|ps[56]|xbox|nintendo|codename|announced|unveiled|leaked|launch(ed|es)?)\b/i,
  // "Tell me about X", "Have you heard of X": asking after something specific
  // the model may never have seen
  /\b(tell (me |us )?about|have you heard (of|about)|do you know (about|of|what|who)|what do you know about|(info|information|details|anything) (on|about))\b/i,
  // Statistics and rankings: figures that get revised every year, and an
  // answer with them needs sources (one without cited made-up [1]–[5])
  /\b(share of|percentage of|percent of|statistics|stats|data on|gdp|inflation|unemployment|literacy rate|population of|populous|growth rate|market share|rank(ed|ing|ings)?|top \d+|largest|biggest|richest|highest|lowest)\b/i,
];

// About this chat or something the user sent ("fix this code", "review my
// essay"): answered from the conversation, not the web.
const CHAT_REFERENCE_PATTERNS = [
  /\b(this|that|these|those|above|previous|your|my) (text|code|message|messages|answer|reply|response|paragraph|sentence|essay|story|poem|image|photo|picture|screenshot|file|files|document|pdf|chart|table|output|question|draft|resume|cv|letter|email|notes)\b/i,
];

// Shopping, recommendations, comparisons and local lookups: what is best,
// cheapest, open or available changes all the time, whatever verb the request
// starts with ("make a list of the best phones under 30000").
const LOOKUP_PATTERNS = [
  /\b(best|top|cheapest|affordable|budget|recommend|recommended|recommendations?|suggest|suggestions?|alternatives? to|vs\.?|versus|reviews?|specs|specifications|where to buy|buy|available in|availability|in stock|near me|nearby|open now|timings?|opening hours|phone number|contact (number|details)|official website|helpline|admission|admissions|eligibility|cut-?off marks?|exam date|notification|vacancy|vacancies|job openings?)\b/i,
  /\b(price|prices|pricing|cost|costs|fee|fees|salary|salaries|tariff|charges|emi|mrp|discount|offers?|deals?)\b/i,
  /(₹|\$|€|£)\s?\d|\b(under|below|within|less than|around) (rs\.? ?|inr ?)?\d/i,
];

// Clearly timeless: no search needed.
const TIMELESS_PATTERNS = [
  // Code and errors
  /```|\b(code|coding|program|function|class|method|variable|loop|bug|debug|error|exception|traceback|stack ?trace|compile|compiler|syntax|regex|sql|script|algorithm|refactor|unit tests?|python|javascript|typescript|java|c\+\+|c#|golang|rust|kotlin|php|html|css|json|yaml|leetcode|dsa|data structures?)\b/i,
  // Maths
  /\b(solve|calculate|compute|simplify|evaluate|integrate|integral|differentiate|derivative|equation|prove|proof|theorem|factori[sz]e|probability|matrix|logarithm|square root|formula)\b/i,
  /^[\d\s+\-*/^().=x×÷%,]+\??$/,
  // Writing, editing, translating, making things
  /^(please |pls |can you |could you |would you |help me |i want you to |i need you to )?(write|draft|compose|rewrite|re-?word|rephrase|paraphrase|summari[sz]e|translate|proofread|correct|edit|improve|shorten|expand|create|make|design|build|draw|sketch|paint|generate|plan|brainstorm|outline|convert|format)\b/i,
  /\b(poem|poems|story|stories|essay|lyrics|song|joke|jokes|riddle|caption|slogan|tagline|bio|cover letter|speech|paragraph|shayari|kavithai)\b/i,
  // Concepts: explaining, defining, how something works
  /^(please |can you |could you )?(explain|define|describe|teach me|help me understand|elaborate)\b/i,
  /\b(meaning of|definition of|difference between|differences between|how (does|do) .{1,40} work|what does .{1,40} mean|stands? for|full form of|examples? of|types of|advantages|disadvantages|pros and cons)\b/i,
  // "What is DBMS", "what are enzymes": a short concept, no digits or versions
  /^(what|who) (is|are) (a |an |the )?[a-z][a-z-]*( [a-z][a-z-]*)?\s*\??$/i,
  // The user's own life, small talk
  /^(i|i'm|im|i am|i've|my|we|we're|our|me|let's|lets)\b/i,
  /^(hi|hii+|hello|hey|yo|thanks|thank you|thx|ok|okay|k|cool|nice|great|good|awesome|wow|yes|yeah|yep|no|nope|sure|continue|go on|more|again|why|how so|really|lol|haha|bye|good (morning|afternoon|evening|night)|love you|help me|are you there|you there)\b/i,
  /\b(how are you|what can you do|tell me a joke|motivate me|cheer me up|pretend|role ?play|let's play|let us play)\b/i,
];

// Modes for making or explaining things: only clearly-current questions search.
const TIMELESS_MODES = new Set(["code", "coding", "debugger", "creative", "design", "summarize", "analyst", "computer_use", "code_exec", "data_analysis"]);

// Questions about VetroAI itself ("tell about VetroAI ceo") are answered from
// its own facts (config/aboutVetroAI.js); a web search only found noise.
const ABOUT_SELF = /\bvetro ?ai\b|\byour (ceo|founder|creator|owner|company|team)\b|\bwho (made|built|created|founded|owns|runs) you\b/i;

const matches = (patterns, text) => patterns.some((rx) => rx.test(text));

/**
 * Whether a question should be searched on the web before it is answered.
 * `mode` is the chat mode; in TIMELESS_MODES only clearly-current questions
 * search.
 */
function needsLiveInfo(query, { mode } = {}) {
  const q = String(query || "").trim();
  if (!q || ABOUT_SELF.test(q)) return false;
  if (matches(LIVE_INFO_PATTERNS, q)) return true;
  if (TIMELESS_MODES.has(String(mode || "").toLowerCase())) return false;
  if (matches(CHAT_REFERENCE_PATTERNS, q)) return false;
  if (matches(LOOKUP_PATTERNS, q)) return true;
  if (matches(TIMELESS_PATTERNS, q)) return false;
  // Anything else that asks about the world. One word ("Kubernetes") is
  // usually a concept, not a lookup.
  return q.split(/\s+/).filter(Boolean).length >= 2;
}

module.exports = {
  LIVE_INFO_PATTERNS, CHAT_REFERENCE_PATTERNS, LOOKUP_PATTERNS, TIMELESS_PATTERNS, TIMELESS_MODES, ABOUT_SELF, needsLiveInfo,
};
