// Astrology grounding shared by every model.
//
// The ProKerala lookup used to live inside AIOrchestrator.processRequest, so
// only models answered on the backend ever saw it; browser models (GPT-5.6,
// Claude Sonnet/Opus/Haiku, Gemini 3.x, DeepSeek, Grok, Sonar) answered
// horoscope questions from memory. This module builds the same grounding —
// a system-prompt addition plus the rasi chart block — for the orchestrator
// and for /api/astrology/context, which the frontend calls before handing an
// astrology question to a browser model.

const Groq = require("groq-sdk");
const { config } = require("../config/env");
const logger = require("../utils/logger");
const { getAstrologyData, extractBirthDetails } = require("./prokeralaService");

// English and common Indian terms ("what is my rasi?", "jathagam").
const ASTROLOGY_RE = /\b(horoscopes?|astrology|astrological|astrologer|natal chart|birth chart|zodiac(?: sign)?|sun sign|moon sign|rising sign|ascendant|kundli|kundali|kundale?e|janam kundli|jathagam|jathakam|jatakam|rasi|rashi|raasi|rasi palan|nakshatra|nakshatram|natchathiram|lagna|lagnam|dasha|mahadasha|antardasha|panchang|panchangam|navamsa|birth star|star sign)\b/i;

// The assistant asked for birth details on the previous turn.
const ASKED_FOR_BIRTH = /\bbirth\b[\s\S]{0,120}\b(date|time|place|city)\b|\b(date|time|place|city)\b[\s\S]{0,60}\bof birth\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (word) => {
  const i = MONTHS.indexOf(String(word || "").slice(0, 3).toLowerCase());
  return i === -1 ? null : i + 1;
};
const MONTH_WORD = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const textOf = (m) => (typeof m?.content === "string" ? m.content : "");

// True when this turn is about astrology: the question itself, a recent user
// message, or a reply to the assistant asking for birth details.
function isAstrologyConversation(messages = [], userQuery = "") {
  if (ASTROLOGY_RE.test(userQuery)) return true;
  const recent = messages.slice(-6);
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const recentUsers = recent.filter((m) => m.role === "user").slice(-3);
  const earlierAstro = recentUsers.some((m) => ASTROLOGY_RE.test(textOf(m)));
  const looksLikeBirthData = /\b(19|20)\d{2}\b/.test(userQuery) || /\d{1,2}[:.]\d{2}/.test(userQuery);
  return Boolean((earlierAstro || (lastAssistant && ASKED_FOR_BIRTH.test(textOf(lastAssistant)))) && looksLikeBirthData);
}

// Reads common birth-detail formats straight from the chat, so the lookup
// works without Groq: "5 March 1998, 10:30 am, Chennai", "March 5 1998 at
// 22:15 in Mumbai", "05/03/1998 10.30pm born in Pune", "1998-03-05".
function parseBirthDetails(text) {
  const s = String(text || "");
  const out = {};

  let m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s,.-]+${MONTH_WORD}[\\s,.-]+((?:19|20)\\d{2})\\b`, "i").exec(s);
  if (m) Object.assign(out, { day: +m[1], month: monthIndex(m[2]), year: +m[3] });
  if (!out.year) {
    m = new RegExp(`\\b${MONTH_WORD}[\\s,.-]+(\\d{1,2})(?:st|nd|rd|th)?[\\s,.-]+((?:19|20)\\d{2})\\b`, "i").exec(s);
    if (m) Object.assign(out, { month: monthIndex(m[1]), day: +m[2], year: +m[3] });
  }
  if (!out.year) {
    m = /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(s);
    if (m) Object.assign(out, { year: +m[1], month: +m[2], day: +m[3] });
  }
  if (!out.year) {
    // Day first, as written in India: 05/03/1998 = 5 March 1998.
    m = /\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})\b/.exec(s);
    if (m) Object.assign(out, { day: +m[1], month: +m[2], year: +m[3] });
  }
  if (out.month && (out.month < 1 || out.month > 12)) delete out.month;
  if (out.day && (out.day < 1 || out.day > 31)) delete out.day;

  m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(s);
  if (m) {
    let hour = +m[1] % 12;
    if (/p/i.test(m[3])) hour += 12;
    Object.assign(out, { hour, minute: m[2] ? +m[2] : 0 });
  } else {
    m = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?![-/.]\d)/.exec(s.replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " "));
    if (m) Object.assign(out, { hour: +m[1], minute: +m[2] });
  }

  m = /\b(?:born\s+in|born\s+at|place(?:\s+of\s+birth)?\s*[:-]|city\s*[:-]|birth\s*place\s*[:-]|in|at)\s+([A-Z][A-Za-z.'-]+(?:[\s,]+[A-Z][A-Za-z.'-]+){0,2})/.exec(s);
  if (m) {
    const city = m[1].replace(/[,\s]+$/, "").trim();
    if (!monthIndex(city) || city.length > 3) out.city = city;
  }
  return out;
}

async function resolveBirthDetails(messages) {
  const userText = messages.filter((m) => m.role === "user").slice(-4).map(textOf).join("\n");
  const parsed = parseBirthDetails(userText);
  if (parsed.year && parsed.month && parsed.day && parsed.city) return parsed;
  const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
  const viaGroq = groq ? await extractBirthDetails(messages, groq) : null;
  const merged = { ...(viaGroq || {}), ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null)) };
  return merged.year && merged.month && merged.day && merged.city ? merged : null;
}

const PROMPT_MISSING = `\n\n[ASTROLOGY REQUEST DETECTED]\nThe user is asking about astrology. To provide highly accurate, personalized readings using our ProKerala API integration, you MUST politely ask the user for their birth date (year, month, day), time of birth (hour, minute), and city of birth. Do not make up a horoscope without this data.`;
const PROMPT_ERROR = `\n\n[ASTROLOGY API ERROR]\nAn error occurred while fetching data from ProKerala (timeout, rate limit, or the city could not be located). Do NOT hallucinate a chart or guess their sign. Politely inform the user that the astrology server is currently unavailable, or ask them to double-check the city name, and try again.`;
const promptWithData = (astroContext) => `\n\n[LIVE ASTROLOGY API DATA]\nBased on the user's birth details, here is their highly accurate astrological data retrieved directly from ProKerala (kundli, planetPosition, dashaPeriods):\n${astroContext}\n\nA visual rasi (birth chart) image has ALREADY been shown above your response in the chat — do not say you cannot show a chart, and do not ask the user if they want one. Simply continue directly into explaining what is in it.\n\nCRITICAL ASTROLOGY RULES:\n1. ONLY use this exact fetched data. Do not guess or estimate. Provide exact mathematical degrees where available (e.g., 18°43').\n2. Clearly state: Vedic Sidereal system, Lahiri Ayanamsa.\n3. You MUST explicitly credit the data source — start your response with a line stating this reading uses live data from the ProKerala Astrology API (e.g. "*Data sourced live from the ProKerala Astrology API.*"), so the user knows this isn't a guess or generic reading.\n4. Format your response strictly using this Markdown template:\n\n*Data sourced live from the ProKerala Astrology API.*\n\n### Chart Details\n* **System:** Vedic Sidereal (Lahiri Ayanamsa)\n* **Ascendant:** [Sign] at [Degree]\n* **Moon Sign:** [Sign] at [Degree] (Nakshatra: [Name], Pada: [Number])\n* **Sun Sign:** [Sign] at [Degree]\n\n### Planetary Placements\n* **[Planet]:** [Sign] at [Degree] in House [Number] [List Retrograde if true]\n(List all planets from the planetPosition data)\n\n### Current Dasha Period\n* **Mahadasha:** [Lord]\n* **Antardasha:** [Lord] (Start to End dates)\n(From the dashaPeriods data)\n\n### Vedic Interpretation\n(Provide a grounded interpretation of these specific placements based on traditional Vedic astrology. Do not use generic statements or deterministic fortunes.)\n\nFollow this structure exactly.`;

// { status: "none" | "missing" | "error" | "ok", prompt, chartBlock }
async function buildAstrologyContext(messages = [], userQuery = "", { reqId } = {}) {
  if (!isAstrologyConversation(messages, userQuery)) return { status: "none", prompt: "", chartBlock: "" };
  try {
    const details = await resolveBirthDetails(messages);
    if (!details) return { status: "missing", prompt: PROMPT_MISSING, chartBlock: "" };
    const astroData = await getAstrologyData(details);
    if (!astroData) return { status: "error", prompt: PROMPT_ERROR, chartBlock: "" };
    // The chart SVG is shown to the reader, not sent to the model — it's a
    // large base64 blob the model has no use for in text.
    const { chartImage, ...forModel } = astroData;
    const chartBlock = chartImage
      ? `\n\n\`\`\`json\n${JSON.stringify({ type: "visual_gallery", query: "Birth Chart", images: [{ url: chartImage, caption: "Rasi Chart (North Indian style)" }] })}\n\`\`\`\n\n`
      : "";
    return { status: "ok", prompt: promptWithData(JSON.stringify(forModel)), chartBlock };
  } catch (err) {
    logger.error("astrology.context.error", { reqId, error: err.message });
    return { status: "error", prompt: PROMPT_ERROR, chartBlock: "" };
  }
}

module.exports = { ASTROLOGY_RE, isAstrologyConversation, parseBirthDetails, buildAstrologyContext };
