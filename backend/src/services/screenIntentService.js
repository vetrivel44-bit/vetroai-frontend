// Does a task need VetroAI to work the computer itself (the screen agent in
// the desktop app), or is a written reply enough?
//
// The app's word patterns (frontend lib/screenIntent.js) catch the usual ways
// of asking ("open telegram", "go to amazon.in"), but people phrase things
// every way there is: "pull up spotify and put on some lofi", "chrome la
// weather paaru", "youtube kholo". Those came back as a chat answer that only
// described doing it. A small, fast model (the search judge's,
// SEARCH_PLANNER_MODEL) now reads the task, the way a person would, and
// answers SCREEN or CHAT. The patterns still decide first, and decide alone
// when the model is unavailable or slow.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { withGroqModel, quietReasoning } = require("../utils/groqModel");
const { plainReading, isAboutSelf, isSmallTalk, isFollowUpRequest } = require("./liveInfoIntent");

// Waiting longer than this would hold up starting the task.
const DECIDE_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const INSTRUCTIONS = `You decide whether a task sent to VetroAI needs it to operate the user's computer, or only needs a written reply. VetroAI runs on the user's computer and can use its mouse, keyboard, apps and web browser.

Answer SCREEN when doing the task means using the computer itself: opening, closing or switching apps, windows, folders, files or browser tabs; going to a website and acting on it (searching on that site, filling a form, logging in, booking, ordering, checking live prices, stock or availability on a shopping, travel or food site); playing, pausing or skipping music and videos; typing, clicking or scrolling somewhere; changing settings such as volume, brightness, Wi-Fi or dark mode; taking a screenshot; downloading or installing something; sending something through an app.

Answer CHAT when a written reply is enough: questions and explanations; news, scores, weather and other facts (VetroAI can look these up on the web without the screen); writing, translating, summarising; code; maths; advice and plans; research reports, slide decks, documents and spreadsheets VetroAI makes itself; files the user attached; greetings and small talk; questions about VetroAI.

The task may be short, in text-speak, misspelt, or in another language, including Tamil or Hindi typed in English letters. Judge what the person wants done.

Examples:
"pull up spotify and put on some lofi" -> SCREEN
"whats the weather in chennai" -> CHAT
"chrome la weather paaru" -> SCREEN
"youtube kholo aur arijit ke gaane chalao" -> SCREEN
"attach the resume from my downloads to the email draft" -> SCREEN
"write an email to my boss asking for leave" -> CHAT
"see if boat earbuds are cheaper on flipkart or amazon right now" -> SCREEN
"explain how chrome extensions work" -> CHAT
"make a ppt on climate change" -> CHAT
"turn on dark mode" -> SCREEN
"who won the match yesterday" -> CHAT

Reply with exactly one word: SCREEN or CHAT.`;

let client = null;
let clientKey = null;
function groqClient() {
  if (!config.groqApiKey) return null;
  if (!client || clientKey !== config.groqApiKey) {
    client = new Groq({ apiKey: config.groqApiKey });
    clientKey = config.groqApiKey;
  }
  return client;
}

/** Asks the model; resolves to the raw reply text. Tests replace it. */
let askModel = async (messages) => {
  const groq = groqClient();
  if (!groq) throw new Error("no Groq key");
  const completion = await withGroqModel(groq, config.searchPlannerModel, (model) => groq.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_tokens: 16,
    ...quietReasoning(model),
  }));
  return completion?.choices?.[0]?.message?.content || "";
};

const cache = new Map();

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no decision within ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Whether `text` needs the computer operated.
 * Resolves to { screen: true | false, by: "rules" | "model" }, or
 * { screen: null, by: "unavailable", reason } when the model couldn't say, so
 * the caller's own patterns decide.
 */
async function decideScreen({ text } = {}) {
  const task = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  // Nothing to do on a screen: small talk, a question about VetroAI, "in
  // short" about the last answer. No model needed.
  if (!task || isAboutSelf(task) || isSmallTalk(task) || isFollowUpRequest(task)) return { screen: false, by: "rules" };

  const key = task.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { screen: hit.screen, by: "model", cached: true };

  const plain = plainReading(task);
  const messages = [
    { role: "system", content: INSTRUCTIONS },
    { role: "user", content: `Task: ${task}${plain.toLowerCase() !== key ? `\n(In plain words: ${plain})` : ""}` },
  ];
  try {
    const reply = String(await withTimeout(askModel(messages), DECIDE_TIMEOUT_MS)).toUpperCase();
    const screen = /\bSCREEN\b/.test(reply) ? true : /\bCHAT\b/.test(reply) ? false : null;
    if (screen === null) return { screen: null, by: "unavailable", reason: "unclear reply" };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { screen, at: Date.now() });
    return { screen, by: "model" };
  } catch (err) {
    logger.warn("screenIntent.unavailable", { error: err.message });
    return { screen: null, by: "unavailable", reason: err.message };
  }
}

module.exports = {
  decideScreen,
  DECIDE_TIMEOUT_MS,
  INSTRUCTIONS,
  // Tests stand in for the model, and start from an empty cache.
  setModel: (fn) => { askModel = fn; },
  clearCache: () => cache.clear(),
};
