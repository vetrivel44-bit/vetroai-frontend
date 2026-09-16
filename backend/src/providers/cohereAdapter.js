const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Cohere's OpenAI-compatible endpoint — same request/response shape as the
// other REST adapters (sambanova, plugsky), so AIOrchestrator's SSE parsing
// needs no special-casing for this provider.
const COHERE_ENDPOINT = "https://api.cohere.ai/compatibility/v1/chat/completions";

async function generateStream(messages, options = {}) {
  if (!config.cohereApiKey) {
    throw new ApiError(500, "Cohere API key not configured.");
  }

  const { temperature, maxTokens, model } = options;

  const body = {
    model: model || config.cohereModel || "command-r-plus-08-2024",
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true,
  };

  try {
    const res = await fetch(COHERE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.cohereApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Cohere service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("cohereAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
