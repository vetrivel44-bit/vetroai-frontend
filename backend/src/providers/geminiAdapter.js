const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

async function generateStream(messages, options = {}) {
  if (!config.geminiApiKey) {
    throw new ApiError(500, "Gemini API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:streamGenerateContent?key=${config.geminiApiKey}`;

  const contents = messages.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 2048,
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Gemini service error: ${res.status} ${detail}`);
    }

    return res.body;
  } catch (err) {
    logger.error("geminiAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
};
