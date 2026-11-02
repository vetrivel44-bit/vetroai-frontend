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
  /^(i|iam|i'm|im|i am|i've|ive|my|we|we're|our|me|let's|lets)\b/i,
  /^(hi|hii+|hello|hey|yo|thanks|thank you|thx|ok|okay|k|cool|nice|great|good|awesome|wow|yes|yeah|yep|no|nope|sure|continue|go on|more|again|why|how so|really|lol|haha|bye|good (morning|afternoon|evening|night)|love you|help me|are you there|you there)\b/i,
  /\b(how are you|what can you do|tell me a joke|motivate me|cheer me up|pretend|role ?play|let's play|let us play)\b/i,
];

// A short message about how the user feels ("iam happy", "i'm so tired
// today"): talk, not a lookup, even with a time word in it. Searching "I am
// happy" once answered with facts about Pharrell Williams' song.
const FEELINGS_PATTERN = /^(i|iam|i'm|im|i am|i feel|i'm feeling|im feeling|i am feeling|feeling|me|my mood is)\b.{0,40}\b(happy|sad|bored|tired|angry|upset|excited|lonely|stressed|depressed|anxious|nervous|hungry|sleepy|sick|fine|good|great|okay|ok|alright|better|worse|confused|scared|proud|grateful|in love|blessed|relaxed|calm|annoyed|frustrated|worried)\b/i;

// Modes for making or explaining things: only clearly-current questions search.
const TIMELESS_MODES = new Set(["code", "coding", "debugger", "creative", "design", "summarize", "analyst", "computer_use", "code_exec", "data_analysis"]);

// People write to the assistant the way they text: "Ur name", "who r u",
// "how r u", "thank u". Every pattern here is written for plain words, so a
// message is read through this first. It is only for deciding: the message
// itself, and anything searched for it, keeps the user's own words.
const CHAT_SPEAK = {
  u: "you", yu: "you", yoo: "you",
  ur: "your", urs: "yours", urself: "yourself", urslf: "yourself", yourslf: "yourself", yrself: "yourself",
  r: "are", ru: "are you", youre: "you are", ure: "you are",
  wat: "what", wht: "what", wut: "what", wot: "what", wats: "what is", whats: "what is", "what's": "what is", "wat's": "what is", whts: "what is", wuts: "what is",
  hw: "how", hws: "how is", hows: "how is", "how's": "how is",
  hu: "who", whos: "who is", "who's": "who is", wheres: "where is", "where's": "where is",
  wer: "where", whr: "where", wen: "when", frm: "from", abt: "about", abut: "about",
  pls: "please", plz: "please", plss: "please", plzz: "please",
  thx: "thanks", thnx: "thanks", thanx: "thanks", thnks: "thanks", tnx: "thanks", tq: "thanks", ty: "thanks", tqsm: "thanks so much", tysm: "thanks so much", tqu: "thank you", tku: "thank you",
  gud: "good", gd: "good", mrng: "morning", mrg: "morning", morng: "morning", mornin: "morning", nite: "night", nyt: "night", gn: "good night", gm: "good morning",
  luv: "love", wassup: "what is up", wazzup: "what is up", whatsup: "what is up", sup: "what is up",
  kk: "ok", okk: "ok", okie: "ok", okey: "ok", oki: "ok",
  dat: "that", dis: "this", bcz: "because", coz: "because", cuz: "because", ppl: "people",
  hv: "have", hav: "have", cn: "can", cud: "could", shud: "should", wud: "would", knw: "know", kno: "know",
  "2day": "today", tdy: "today", tmrw: "tomorrow", tmr: "tomorrow", "2moro": "tomorrow", b4: "before",
};

function normalizeChatSpeak(text) {
  return String(text || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[A-Za-z0-9']+/g, (word) => CHAT_SPEAK[word.toLowerCase()] ?? word)
    .replace(/\s+/g, " ")
    .trim();
}

// Questions to the assistant about itself: its name, who made it, what model
// it is, where it's from ("Ur name", "who r u", "r u chatgpt", "tera naam kya
// hai", "un peru enna"). They are answered from VetroAI's own facts
// (config/aboutVetroAI.js). Searched, "Ur name" came back as the history of
// the ancient city of Ur. Read after normalizeChatSpeak.
const ABOUT_SELF = new RegExp([
  String.raw`\bvetro ?ai\b`,
  String.raw`\byour (?:good |full |real |actual |official |nick ?)?name\b(?! (?:movie|film|anime|song|lyrics|ost|book|manga|novel|series))`,
  String.raw`\b(?:do|did) you (?:have|got) (?:a |any )?name\b`,
  String.raw`\b(?:what|how) (?:should|can|do|shall|may|must) (?:i|we) (?:call|address|name) you\b`,
  String.raw`\bwho are you\b`,
  String.raw`\bwho am i (?:talking|chatting|speaking) (?:to|with)\b`,
  String.raw`^(?:and |so |but )?what are you(?: exactly| really| actually)?[\s?!.]*$`,
  String.raw`\bwhat (?:kind|type|sort) of (?:an? )?(?:ai|bot|chatbot|assistant|model|program|thing) (?:are you|is this)\b`,
  String.raw`\b(?:introduce|describe|explain) (?:yourself|your self)\b`,
  String.raw`\b(?:about|of) yourself\b`,
  String.raw`\bwho (?:made|built|created|developed|designed|trained|programmed|coded|invented|founded|owns|runs|make|build|create|develop|design|train|program|own|run|owned|launched|started) you\b`,
  String.raw`\byour (?:creators?|makers?|developers?|devs?|owners?|founders?|co-?founders?|ceo|cto|parent company|inventors?|programmers?|author|architect)\b`,
  String.raw`\b(?:who|what|which) (?:is|are|was|were) your (?:company|team|boss|father|mother|dad|mom|daddy|mommy|parents?|family|origin|history|story)\b`,
  String.raw`\b(?:what|which) (?:ai |language |llm |gpt |base |underlying )?(?:model|llm|ai|version|engine|chatbot|bot|assistant|language model|ai model|technology|tech) (?:are you|is this|do you (?:use|run on|run)|powers you|runs you|is behind you|is powering you)\b`,
  String.raw`\byour (?:model|llm|ai model|language model|base model|architecture|parameters|training data|knowledge cut-?off|cut-?off date|system prompt)\b`,
  String.raw`\bare you (?:an? |the )?(?:chatgpt|chat gpt|gpt[\w.-]*|openai|gemini|bard|claude|anthropic|llama|meta ai|grok|deepseek|qwen|mistral|copilot|siri|alexa|cortana|perplexity|sarvam|human|real|robot|bot|ai|machine|computer|program|person|alive|sentient|conscious|self[- ]aware|male|female|boy|girl|man|woman|doctor|lawyer|teacher|god|single|married|free|paid|better than)\b`,
  String.raw`\b(?:is this|are you) (?:using|based on|built on|running on|powered by|made by|owned by|a product of|connected to)\b`,
  String.raw`\bhow old are you\b`,
  String.raw`\bwhen (?:were|was|are) you (?:made|born|created|built|launched|released|trained|founded|developed|updated)\b`,
  String.raw`\bwhere (?:are you|were you) (?:from|located|based|made|hosted|living|staying|running|born|created|built|developed)\b`,
  String.raw`\bwhere do you (?:live|come from|stay|run|work)\b`,
  String.raw`\b(?:what can you do|how do you work)\b`,
  String.raw`\bwhat are your (?:features|capabilities|abilities|skills|powers|limits|limitations|rules)\b`,
  // Hindi and Tamil, typed in English letters
  String.raw`\b(?:tera|tumhara|tumhra|tumara|aapka|apka|aapki|apki|tumhari|teri) (?:naam|name)\b`,
  String.raw`\b(?:tum|tu|aap|ap) (?:kaun|kon|koun) (?:ho|hai|he|h)\b`,
  String.raw`\b(?:tumhe|tujhe|aapko|apko) (?:kisne|kis ne) (?:banaya|bnaya|banaaya|create kiya)\b`,
  String.raw`\b(?:un|unga|ungal|ungaloda|unnoda|unoda|onga|onnoda|nee|mee) (?:per|peru|peyar|peyaru|pear|name)\b`,
  String.raw`\b(?:nee|ni|neenga|nenga|neengal|ninga) (?:yaaru|yaru|yaar|yar|yaarunga|yarunga)\b`,
  String.raw`\b(?:unna|unga|ungala|onna) (?:yaaru|yaru|yar|yaar) (?:create|uruvakkunathu|uruvaakkinathu|senjathu|senjanga|pannathu|pannanga|made|built)\b`,
].join("|"), "i");

// Short questions that are about the assistant only when that's all they say:
// "ur age" is, "how to change your language on instagram" isn't.
const ABOUT_SELF_SHORT = /\byour (?:age|birthday|birth ?date|gender|location|home|hometown|nationality|country|city|languages?|religion|health|favou?rite\b|purpose|job|work|features?|capabilities|abilities|skills|limits|limitations|rules|hobby|hobbies|personality|mood|feelings?|iq|salary|price|pricing|plans?)\b/i;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/** Is the message a question to the assistant about itself? */
function isAboutSelf(text) {
  const q = normalizeChatSpeak(text);
  if (!q) return false;
  return ABOUT_SELF.test(q) || (wordCount(q) <= 6 && ABOUT_SELF_SHORT.test(q));
}

// A message that is only small talk, start to end: "how r u", "thank u so
// much", "ok bye", "u r smart", "good morning bro". Searching those answered
// with whatever the web had for the words. Read after normalizeChatSpeak.
const SMALL_TALK_PHRASES = [
  String.raw`hi+`, String.raw`hello+`, String.raw`hey+`, String.raw`hai`, String.raw`helo`, String.raw`yo`, String.raw`hola`, String.raw`namaste`, String.raw`vanakkam`,
  String.raw`good (?:morning|afternoon|evening|night|day)`, String.raw`morning`,
  String.raw`thanks?(?: you)?(?: so much| very much| a lot)?`, String.raw`thank you`,
  String.raw`ok(?:ay)?`, String.raw`k`, String.raw`cool`, String.raw`nice`, String.raw`great`, String.raw`awesome`, String.raw`wow`,
  String.raw`yes`, String.raw`yeah`, String.raw`yep`, String.raw`no`, String.raw`nope`, String.raw`sure`, String.raw`fine`,
  String.raw`lol`, String.raw`lmao`, String.raw`(?:ha)+h?`, String.raw`(?:he)+`, String.raw`hm+`, String.raw`o+h+`, String.raw`a+h+`, String.raw`aw+`, String.raw`omg`,
  String.raw`bye`, String.raw`goodbye`, String.raw`see you(?: later| soon)?`, String.raw`take care`,
  String.raw`how are you(?: doing)?`, String.raw`how is it going`, String.raw`how is your day(?: going)?`, String.raw`how was your day`, String.raw`how do you do`, String.raw`how are things`,
  String.raw`what is up`, String.raw`what are you doing`, String.raw`what are you up to`, String.raw`nothing much`, String.raw`not much`, String.raw`same here`, String.raw`me too`,
  String.raw`nice to meet you`, String.raw`pleased to meet you`, String.raw`good to see you`, String.raw`long time no see`,
  String.raw`(?:i )?miss you`, String.raw`(?:i )?love you`, String.raw`are you there`, String.raw`you there`,
  String.raw`(?:you are|you're|your|you) (?:so |very |really |too |the |a |an |such an? )?(?:best|smart|funny|cute|great|good|nice|awesome|amazing|helpful|sweet|kind|cool|genius|clever|wrong|right|correct|bad|slow|stupid|dumb|useless|boring|crazy|mad|liar|lying)`,
];
const SMALL_TALK_FILLERS = [
  "bro", "brother", "da", "dude", "buddy", "man", "machan", "macha", "mate", "anna", "bhai", "yaar", "sir", "madam", "mam", "maam",
  "friend", "dear", "ai", "bot", "vetro ?ai", "again", "too", "so much", "very much", "a lot", "today", "now", "tonight", "there", "please",
];
const SMALL_TALK = new RegExp(
  String.raw`^(?:${SMALL_TALK_PHRASES.join("|")})(?:[\s,.!?]+(?:${[...SMALL_TALK_PHRASES, ...SMALL_TALK_FILLERS].join("|")}))*(?:[\s,.!?~:)(]|\p{Extended_Pictographic}|‍|️)*$`,
  "iu",
);

/** Is the whole message small talk? */
function isSmallTalk(text) {
  return SMALL_TALK.test(normalizeChatSpeak(text));
}

const matches = (patterns, text) => patterns.some((rx) => rx.test(text));

/**
 * Whether a question should be searched on the web before it is answered.
 * `mode` is the chat mode; in TIMELESS_MODES only clearly-current questions
 * search.
 */
function needsLiveInfo(query, { mode } = {}) {
  const q = normalizeChatSpeak(query);
  if (!q || isAboutSelf(q) || isSmallTalk(q)) return false;
  if (q.split(/\s+/).length <= 8 && FEELINGS_PATTERN.test(q)) return false;
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
  FEELINGS_PATTERN, LIVE_INFO_PATTERNS, CHAT_REFERENCE_PATTERNS, LOOKUP_PATTERNS, TIMELESS_PATTERNS, TIMELESS_MODES,
  CHAT_SPEAK, ABOUT_SELF, ABOUT_SELF_SHORT, SMALL_TALK,
  normalizeChatSpeak, isAboutSelf, isSmallTalk, needsLiveInfo,
};
