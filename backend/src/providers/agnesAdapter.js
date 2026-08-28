const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

async function generateStream(messages, options = {}) {
  if (!config.agnesApiKey) {
    throw new ApiError(500, "Agnes AI API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const endpoint = "https://apihub.agnes-ai.com/v1/chat/completions";

  const body = {
    model: model || config.agnesModel,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 2048,
    stream: true,
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.agnesApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const detail = await res.text();
      const errorMsg = `Agnes AI service error: ${res.status} ${detail}`;
      logger.error("agnesAdapter.generateStream.failed", { status: res.status, detail });
      throw new ApiError(res.status, errorMsg);
    }

    if (!res.body) {
      throw new Error("Agnes AI returned empty response body");
    }

    return res.body;
  } catch (err) {
    logger.error("agnesAdapter.generateStream", { error: err.message, errorCode: err.code });
    throw err;
  }
}

module.exports = {
  generateStream,
};
