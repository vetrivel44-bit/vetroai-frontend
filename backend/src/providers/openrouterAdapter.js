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
      timeout: 30000,
    });

    if (!res.ok) {
      const detail = await res.text();
      const errorMsg = `OpenRouter service error: ${res.status} ${detail}`;
      logger.error("openrouterAdapter.generateStream.failed", { status: res.status, detail });
      throw new ApiError(res.status, errorMsg);
    }

    if (!res.body) {
      throw new Error("OpenRouter returned empty response body");
    }

    return res.body;
  } catch (err) {
    logger.error("openrouterAdapter.generateStream", { error: err.message, errorCode: err.code });
    throw err;
  }
}

module.exports = {
  generateStream,
};
