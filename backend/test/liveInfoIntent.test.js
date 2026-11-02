const test = require("node:test");
const assert = require("node:assert/strict");

const { needsLiveInfo, normalizeChatSpeak, plainReading, isAboutSelf, isSmallTalk, isFollowUpRequest } = require("../src/services/liveInfoIntent");
const orchestrator = require("../src/services/AIOrchestrator");

const LIVE = [
  "is TTV Vasan in bigg boss season 10",
  "Is TTV Vasan in Bigg Boss Season 10?",
  "bigg boss tamil season 10 contestants",
  "who hosts bigg boss tamil",
  "who got evicted this week",
  "Did India win the match yesterday",
  "is Vijay still the president of TVK",
  "who is the chief minister of tamil nadu",
  "leo box office collection",
  "when is the next ipl match",
  "upcoming movies on netflix",
  "petrol price of chennai",
  "what happened in 2027",
  "tell about gemini argon",
  "Tell me about Gemini Argon",
  "what is gpt-5.6 sol",
  "have you heard of nano banana",
  "do you know about the pixel 11",
  "any info on the rtx 6090",
  "What share of India's electricity comes from coal, solar, wind, hydro and nuclear? Show it as a chart",
  "Rank the 10 most populous states of India in a chart",
  "literacy rate of kerala",
];

const NOT_LIVE = [
  "hi",
  "what is DBMS",
  "difference between stack and queue",
  "write a poem about rain",
  "explain photosynthesis",
  "fix this python function",
  "plan a birthday party for my son",
  "draw pixel art of a cat",
  "write a story about a dragon",
];

test("questions whose answer may have changed are sent to web search", () => {
  for (const q of LIVE) assert.equal(needsLiveInfo(q), true, q);
});

test("timeless questions are answered without a search", () => {
  for (const q of NOT_LIVE) assert.equal(needsLiveInfo(q), false, q);
});

test("the orchestrator uses the shared patterns", () => {
  assert.equal(orchestrator.needsWebSearch("is TTV Vasan in bigg boss season 10"), true);
  assert.equal(orchestrator.needsWebSearch("what is DBMS"), false);
});

// Questions with no "2026", "latest" or "news" in them, which were answered
// from the models' out-of-date memory before the rule was turned around.
const NO_TIME_WORD_BUT_CURRENT = [
  "best phones under 30000",
  "tamil nadu cm",
  "zephyr x9 review",
  "kerala tourism package cost",
  "who runs twitter",
  "how to apply for passport in india",
  "make a list of the best phones",
  "top engineering colleges in tamil nadu",
  "what is zephyr x9",
  "anna university exam date",
  "TVK party",
];
const STILL_TIMELESS = [
  "review my essay",
  "how does photosynthesis work",
  "why is the sky blue",
  "2+2*3",
  "translate hello to tamil",
  "thank you so much",
  "Kubernetes",
  "what is machine learning",
  "solve x^2 - 4 = 0",
  "good morning",
  "tell me a joke",
  "summarize this document",
];

test("questions without a time word are searched unless they're clearly timeless", () => {
  for (const q of NO_TIME_WORD_BUT_CURRENT) assert.equal(needsLiveInfo(q), true, q);
  for (const q of STILL_TIMELESS) assert.equal(needsLiveInfo(q), false, q);
});

test("in coding, creative and similar modes only clearly-current questions search", () => {
  assert.equal(needsLiveInfo("best laptop for coding", { mode: "debugger" }), false);
  assert.equal(needsLiveInfo("latest react version", { mode: "debugger" }), true);
  assert.equal(needsLiveInfo("best laptop for coding", { mode: "normal" }), true);
  assert.equal(orchestrator.needsWebSearch("tamil nadu cm", "normal"), true);
  assert.equal(orchestrator.needsWebSearch("tamil nadu cm", "summarize"), false);
});

test("the fallback word list never searches a short message about how the user feels", () => {
  for (const q of ["iam happy", "I am happy", "i am so tired today", "feeling sad", "im bored"]) assert.equal(needsLiveInfo(q), false, q);
  assert.equal(needsLiveInfo("I am happy with the new iphone 17 price compared to last year"), true);
});

// People text the assistant: "Ur name", "who r u", "how r u". Read as plain
// words, these are about VetroAI itself or small talk, not lookups.
test("text-speak is read as plain words, for deciding only", () => {
  assert.equal(normalizeChatSpeak("Ur name?"), "your name?");
  assert.equal(normalizeChatSpeak("wat r u doing"), "what are you doing");
  assert.equal(normalizeChatSpeak("who ru"), "who are you");
  assert.equal(normalizeChatSpeak("What’s ur model"), "what is your model");
  assert.equal(normalizeChatSpeak("tq bro, gn"), "thanks bro, good night");
  // Code and maths keep their symbols.
  assert.equal(normalizeChatSpeak("2+2*3"), "2+2*3");
  assert.equal(normalizeChatSpeak("fix this ```js\nconst u = 1;\n```"), "fix this ```js const you = 1; ```");
});

const ABOUT_ITSELF = [
  "Ur name", "ur name", "Ur name?", "wat is ur name", "whats ur name", "what's your name", "can i know ur name", "do u have a name",
  "what should i call u", "your name pls", "who r u", "who ru", "who are u", "hu r u", "who are you", "what r u", "introduce urself",
  "tell me about urself", "tell me abt yourself", "who made u", "who created you", "ur creator", "who is ur owner", "who is ur ceo",
  "ur developer name", "which model r u", "what model are you", "which ai r u", "r u chatgpt", "are u gemini", "r u human", "r u a bot",
  "are u alive", "r u a doctor", "how old r u", "ur age", "where r u from", "where do u live", "when were u made", "how's ur health",
  "what can u do", "ur features", "tera naam kya hai", "aapka naam kya hai", "tum kaun ho", "un peru enna", "unga per enna", "nee yaaru",
  "neenga yaaru", "what is vetroai", "tell about VetroAi ceo",
];
const SMALL_TALK = [
  "how r u", "hw r u", "how are u", "how r u doing", "how r u today", "wat r u doing", "thank u", "thank u so much", "ty so much", "tq bro",
  "love u", "u there?", "r u there", "whats up", "wassup bro", "hmm ok", "ohh nice", "nice to meet u", "u r smart", "you are amazing",
  "ur so funny", "gud mrng", "gn bro", "good nite", "ok bye", "hi how r u", "thanks da 🙏",
];

test("questions to VetroAI about itself are recognised and never searched", () => {
  for (const q of ABOUT_ITSELF) {
    assert.equal(isAboutSelf(q), true, q);
    assert.equal(needsLiveInfo(q), false, q);
    assert.equal(needsLiveInfo(q, { mode: "normal" }), false, q);
  }
});

test("small talk in text-speak is never searched", () => {
  for (const q of SMALL_TALK) {
    assert.equal(isSmallTalk(q) || isAboutSelf(q), true, q);
    assert.equal(needsLiveInfo(q), false, q);
  }
});

// The old identity check matched "what model" and "which ai" anywhere, so
// these were never searched; and "Ur" is also a city.
test("real lookups that mention a model, an AI, a name or Ur still search", () => {
  for (const q of [
    "what model is the iphone 17", "which ai is best for coding", "who is the ceo of google", "ancient city of ur",
    "what is the name of the president of india", "your name movie box office", "hi, who won the match today",
    "how to register your company in india", "you are wrong, who is the current cm of tamil nadu", "gm stock price",
  ]) {
    assert.equal(isAboutSelf(q), false, q);
    assert.equal(isSmallTalk(q), false, q);
    assert.equal(needsLiveInfo(q), true, q);
  }
});

// Short follow-ups about the last answer, the way people type them. Searched,
// "in tamil" found pages about the Tamil language instead of translating.
const REDO = [
  "more", "again", "y?", "y", "eg", "eg?", "why?", "explain", "shorter", "simpler", "tldr", "eli5", "in short", "in tamil", "in hindi pls",
  "in points", "in a table", "in 2 lines", "in 5 points", "explain in tamil", "tell in simple words", "give example", "give an eg",
  "in detail pls", "translate to hindi", "make it shorter", "explain more", "can u explain again", "ok now in hindi",
  "say it in tanglish pls", "write that in 5 points", "more details", "tell me more", "what do you mean", "wdym",
];
test("asking for the last answer another way is never searched", () => {
  for (const q of REDO) {
    assert.equal(isFollowUpRequest(q), true, q);
    assert.equal(needsLiveInfo(q), false, q);
  }
});

test("follow-ups that ask something new still search", () => {
  for (const q of ["in 2025?", "and in 2025?", "in tamil nadu", "in chennai", "tamil movies this week", "more about the iphone 17 price"]) {
    assert.equal(isFollowUpRequest(q), false, q);
    assert.equal(needsLiveInfo(q), true, q);
  }
});

test("shorthand made of symbols or several words is read too", () => {
  assert.equal(normalizeChatSpeak("diff b/w tcp n udp"), "difference between tcp and udp");
  assert.equal(normalizeChatSpeak("diff btw tcp and udp"), "difference between tcp and udp");
  assert.equal(normalizeChatSpeak("hw 2 make tea w/o milk"), "how to make tea without milk");
  assert.equal(needsLiveInfo("diff b/w tcp n udp"), false);
  assert.equal(isSmallTalk("hru"), true);
  assert.equal(isSmallTalk("wbu"), true);
});

// A web search gets the message in plain words, but only where the shorthand
// can't mean anything else: "ur" and "d" stay as typed.
test("the plain reading for a search reads only unambiguous shorthand", () => {
  assert.equal(plainReading("ipl score 2day"), "ipl score today");
  assert.equal(plainReading("wat is d weather in chennai 2day"), "what is d weather in chennai today");
  assert.equal(plainReading("weather rn"), "weather right now");
  assert.equal(plainReading("what abt java"), "what about java");
  assert.equal(plainReading("tom n jerry cast"), "tom and jerry cast");
  for (const q of ["ancient city of ur", "vitamin d deficiency", "r programming tutorial", "u2 band tour", "Who won IPL 2024?"]) {
    assert.equal(plainReading(q), q, q);
  }
});
