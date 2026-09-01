// Chess Arena move endpoint — deliberately separate from chatController /
// AIOrchestrator / ProviderManager. It reads its own CHESS_*_API_KEY env vars
// and talks to each provider directly, so wiring keys in here can never
// change behavior for the main chat (which keeps using its own GROQ_API_KEY,
// MISTRAL_API_KEY, GEMINI_API_KEY, etc).
const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");

const TIMEOUT_MS = 20000;

async function callMistral({ prompt, apiKey, model, temperature, maxTokens }) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, `Mistral request failed: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGroq({ prompt, apiKey, model, temperature, maxTokens }) {
  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });
  return completion.choices?.[0]?.message?.content || "";
}

async function callGemini({ prompt, apiKey, model, temperature, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Some Gemini models reason internally before answering (billed as
      // output tokens); a small thinking budget keeps a short move+reason
      // reply from being silently swallowed by that reasoning overhead.
      generationConfig: { temperature, maxOutputTokens: Math.max(maxTokens, 250), thinkingConfig: { thinkingBudget: 48 } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, `Gemini request failed: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("");
}

async function callOpenRouter({ prompt, apiKey, model, temperature, maxTokens }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vetroai.app",
      "X-Title": "VetroAI Chess Arena",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, `OpenRouter request failed: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function providerTable() {
  return {
    mistral: { fn: callMistral, apiKey: config.chessMistralApiKey, model: config.chessMistralModel },
    groq: { fn: callGroq, apiKey: config.chessGroqApiKey, model: config.chessGroqModel },
    gemini: { fn: callGemini, apiKey: config.chessGeminiApiKey, model: config.chessGeminiModel },
    openrouter: { fn: callOpenRouter, apiKey: config.chessOpenRouterApiKey, model: config.chessOpenRouterModel },
  };
}

async function chessMove(req, res) {
  const provider = String(req.body?.provider || "").toLowerCase().trim();
  const prompt = String(req.body?.prompt || "").trim();
  const temperature = Number(req.body?.temperature ?? 0.75);
  const maxTokens = Math.min(Number(req.body?.maxTokens ?? 200) || 200, 400);

  if (!prompt) throw new ApiError(400, "Missing prompt.");

  const entry = providerTable()[provider];
  if (!entry) throw new ApiError(400, `Unknown chess provider "${provider}".`);
  if (!entry.apiKey) throw new ApiError(503, `Chess provider "${provider}" is not configured.`);

  try {
    const text = await entry.fn({ prompt, apiKey: entry.apiKey, model: entry.model, temperature, maxTokens });
    return successResponse(res, "ok", { text, provider, model: entry.model });
  } catch (err) {
    logger.warn("chess.move.provider_error", { provider, message: err.message });
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, `${provider} request failed: ${err.message}`);
  }
}

function getChessProviders(_req, res) {
  const available = Object.entries(providerTable())
    .filter(([, entry]) => Boolean(entry.apiKey))
    .map(([id]) => id);
  return successResponse(res, "ok", { providers: available });
}

module.exports = { chessMove, getChessProviders };
