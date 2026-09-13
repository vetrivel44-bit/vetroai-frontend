const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

async function generateStream(messages, options = {}) {
  if (!config.geminiApiKey) {
    throw new ApiError(500, "Gemini API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  // Use gemini-1.5-flash as default (separate quota from gemini-2.0-flash)
  const modelName = model || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${config.geminiApiKey}`;

  const systemMessage = messages.find(m => m.role === "system");
  const chatMessages = messages.filter(m => m.role !== "system");

  const contents = chatMessages.map(msg => {
    const parts = [];
    if (msg.content) parts.push({ text: msg.content });
    // Computer mode's screen-control agent attaches the current screenshot here.
    if (Array.isArray(msg.images)) {
      for (const img of msg.images) {
        if (img?.data && img?.mimeType) parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
      }
    }
    return {
      role: msg.role === "assistant" ? "model" : "user",
      parts: parts.length ? parts : [{ text: "" }]
    };
  });

  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 2048,
    }
  };

  if (systemMessage) {
    body.system_instruction = {
      parts: [{ text: systemMessage.content }]
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
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
