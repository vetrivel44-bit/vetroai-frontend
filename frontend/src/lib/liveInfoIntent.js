// Does a question need live information from the web? Used for browser
// models, where the app runs the search itself; the auto-search setting is
// only permission, and a turn searches when these patterns match.
//
// Same patterns as backend/src/services/liveInfoIntent.js (which explains
// why they grew past "today / latest / news"); keep the two in step.

export const LIVE_INFO_PATTERNS = [
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
  /\b(gemini|gpt[- ]?\d[\w.]*|chatgpt|openai|claude|anthropic|llama|grok|deepseek|qwen|mistral|copilot|sora|veo|midjourney|perplexity|iphone|pixel \d+|galaxy [sza]\d+|ios \d+|android \d+|rtx ?\d+|playstation|ps[56]|xbox|nintendo|codename|announced|unveiled|leaked|launch(ed|es)?)\b/i,
  // "Tell me about X", "Have you heard of X": asking after something specific
  // the model may never have seen
  /\b(tell (me |us )?about|have you heard (of|about)|do you know (about|of|what|who)|what do you know about|(info|information|details|anything) (on|about))\b/i,
  // Statistics and rankings: revised every year, and they need sources
  /\b(share of|percentage of|percent of|statistics|stats|data on|gdp|inflation|unemployment|literacy rate|population of|populous|growth rate|market share|rank(ed|ing|ings)?|top \d+|largest|biggest|richest|highest|lowest)\b/i,
];

// Questions about VetroAI itself are answered from its own facts (lib/aboutVetroAI).
export const ABOUT_SELF = /\bvetro ?ai\b|\byour (ceo|founder|creator|owner|company|team)\b|\bwho (made|built|created|founded|owns|runs) you\b/i;

export function needsLiveInfo(query) {
  const q = String(query || "");
  if (ABOUT_SELF.test(q)) return false;
  return LIVE_INFO_PATTERNS.some((rx) => rx.test(q));
}
