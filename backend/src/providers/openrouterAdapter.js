const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

async function generateStream(messages, options = {}) {
  if (!config.openrouterApiKey) {
    throw new ApiError(500, "OpenRouter API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  
  const body = {
    model: model || config.openrouterModel || "meta-llama/llama-3.3-70b-instruct",
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true,
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vetroai.com",
        "X-Title": "VetroAI",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OpenRouter service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("openrouterAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
