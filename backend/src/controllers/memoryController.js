const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");

// ChatGPT-style automatic memory: given one message the user just sent, name
// the durable personal facts in it (0-3). Runs server-side on a small, fast
// model (Groq, then Gemini, Mistral, Cerebras) so it works even when the
// browser's Puter bridge isn't loaded.
const MEMORY_MODEL = process.env.MEMORY_MODEL || "llama-3.1-8b-instant";
const MAX_INPUT = 1500;
const MAX_FACT = 300;

const SYSTEM_PROMPT = `You extract durable personal facts about the user from a single chat message, the way ChatGPT remembers things between separate conversations.

Return ONLY a JSON object: {"facts": [ ... ]} — each item a short, specific, durable fact worth remembering long-term (name, studies or job, ongoing project, goal or exam, deadline, preference, how they like answers, important people, location). Write each fact in third person about "the user" style without the word "user", e.g. "is preparing for TCS NQT", "studies CSE at MSRIT", "prefers short answers in simple words".

Rules:
- Stated preferences about how answers should be written ("I prefer short answers", "explain in simple words", "reply in Tamil") ARE durable facts — always keep them.
- Return {"facts": []} when nothing durable is stated — most messages have none. Questions, small talk, one-off requests and temporary moods are NOT facts.
- Only facts the user states about themselves. Never invent or infer.
- Never include passwords, API keys, tokens, card or ID numbers, or anything that looks like a credential.
- At most 3 facts. Skip anything already in the "Already remembered" list.`;

function cleanFacts(raw, known) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim());
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.facts) ? parsed.facts : [];
  const seen = new Set(known.map((k) => k.toLowerCase().trim()));
  return list
    .filter((f) => typeof f === "string")
    .map((f) => f.trim().replace(/[.\s]+$/, ""))
    .filter((f) => f.length >= 3 && f.length <= MAX_FACT)
    .filter((f) => !/(api[_ -]?key|password|token|secret|\b\d{12,}\b)/i.test(f))
    .filter((f) => !seen.has(f.toLowerCase()))
    .slice(0, 3);
}

// OpenAI-compatible providers tried in order; the first that answers wins.
// Groq is fastest, but keys get rotated or revoked, so Gemini, Mistral and
// Cerebras (already used elsewhere in this backend) back it up.
function providers() {
  const list = [];
  if (config.groqApiKey) list.push({ name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", key: config.groqApiKey, model: MEMORY_MODEL });
  if (config.geminiApiKey) list.push({ name: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: config.geminiApiKey, model: process.env.MEMORY_GEMINI_MODEL || config.geminiModel || "gemini-2.5-flash" });
  if (config.mistralApiKey) list.push({ name: "mistral", url: "https://api.mistral.ai/v1/chat/completions", key: config.mistralApiKey, model: process.env.MEMORY_MISTRAL_MODEL || "mistral-small-latest" });
  if (process.env.CEREBRAS_API_KEY) list.push({ name: "cerebras", url: "https://api.cerebras.ai/v1/chat/completions", key: process.env.CEREBRAS_API_KEY, model: process.env.CEREBRAS_MODEL || "gpt-oss-120b" });
  return list;
}

async function callProvider(p, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(p.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: 300, response_format: { type: "json_object" }, messages }),
    });
    if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

async function extractMemories(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) throw new ApiError(400, "text is required");

  const known = Array.isArray(req.body?.known)
    ? req.body.known.filter((k) => typeof k === "string").slice(-50).map((k) => k.slice(0, MAX_FACT))
    : [];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Already remembered:\n${known.length ? known.map((k) => `- ${k}`).join("\n") : "(none)"}\n\nMessage:\n${text.slice(0, MAX_INPUT)}`,
    },
  ];

  const errors = [];
  for (const p of providers()) {
    try {
      let raw;
      try {
        raw = await callProvider(p, messages);
      } catch (err) {
        // Free tiers rate-limit per second; one short retry clears most 429s.
        if (!/HTTP 429/.test(err.message)) throw err;
        await new Promise((r) => setTimeout(r, 1500));
        raw = await callProvider(p, messages);
      }
      const facts = cleanFacts(raw, known);
      logger.info("memory.extract", { provider: p.name, found: facts.length });
      return successResponse(res, "ok", { facts, provider: p.name });
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
    }
  }
  logger.warn("memory.extract.unavailable", { errors });
  // 503 tells the frontend to fall back to its in-browser (Puter) extractor.
  throw new ApiError(503, "Memory extraction is unavailable right now");
}

module.exports = { extractMemories, _cleanFacts: cleanFacts };
