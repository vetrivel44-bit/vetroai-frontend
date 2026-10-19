const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Sarvam AI (sarvam.ai): Indian models, strong in Hindi, Tamil and the other
// Indian languages as well as English. OpenAI-compatible chat completions.
const ENDPOINT = "https://api.sarvam.ai/v1/chat/completions";
const DEFAULT_MODEL = "sarvam-105b";
// sarvam-30b: faster and cheaper, 64K context. sarvam-105b: stronger, 128K.
const MAX_TOKENS_CAP = 16384;

/** "Sarvam 30B" → sarvam-30b, "Sarvam 105B" → sarvam-105b, else the configured default. */
function modelFor(label) {
  const text = String(label || "");
  if (!/sarvam/i.test(text)) return null;
  if (/\b30\s*b\b/i.test(text)) return "sarvam-30b";
  if (/\b105\s*b\b/i.test(text)) return "sarvam-105b";
  return config.sarvamModel || DEFAULT_MODEL;
}

// Chat models of this kind reject a conversation that has two turns of the
// same role in a row, or a system message anywhere but first. The history can
// carry both (a retried turn, a system note added mid-chat), so fold it into
// the shape the API accepts instead of failing the request.
function shapeMessages(messages) {
  const system = [];
  const turns = [];
  for (const m of messages || []) {
    const content = typeof m?.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    if (m.role === "system") { system.push(content); continue; }
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  // The first non-system turn has to be the user's.
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", content: "(continuing our conversation)" });
  return [...(system.length ? [{ role: "system", content: system.join("\n\n") }] : []), ...turns];
}

async function request(body, { timeoutMs }) {
  if (!config.sarvamApiKey) {
    throw new ApiError(500, "Sarvam API key not configured on the backend.");
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      // Sarvam's own header; Bearer is accepted too, for OpenAI-style clients.
      "api-subscription-key": config.sarvamApiKey,
      Authorization: `Bearer ${config.sarvamApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new ApiError(res.status, `Sarvam service error: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

async function generateStream(messages, options = {}) {
  const { temperature, maxTokens, sarvamModel } = options;
  try {
    const res = await request({
      model: sarvamModel || config.sarvamModel || DEFAULT_MODEL,
      messages: shapeMessages(messages),
      temperature: temperature ?? 0.7,
      max_tokens: Math.min(maxTokens ?? 4096, MAX_TOKENS_CAP),
      stream: true,
    }, { timeoutMs: 30000 });
    return res.body;
  } catch (err) {
    logger.error("sarvamAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming completion for short side tasks (chat titles, follow-ups).
async function complete(messages, { temperature = 0.4, maxTokens = 120 } = {}) {
  const res = await request({
    model: "sarvam-30b",
    messages: shapeMessages(messages),
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }, { timeoutMs: 15000 });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

module.exports = { generateStream, complete, modelFor, shapeMessages, DEFAULT_MODEL };
