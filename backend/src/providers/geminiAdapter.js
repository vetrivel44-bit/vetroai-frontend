const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Gemini 2.5 and 3 models think before they answer, and the thinking is
// spent from maxOutputTokens: a short reply, like a screen-control step's one
// JSON action, can be left with no tokens at all. `thinking: "low"` keeps the
// thinking short, in the setting each model family takes; other models get
// no thinking setting.
function thinkingConfigFor(modelName, thinking) {
  if (thinking !== "low") return null;
  const name = String(modelName || "").replace(/^models\//, "");
  if (/^gemini-3/i.test(name)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5/i.test(name)) return { thinkingBudget: 512 };
  return null;
}

async function generateStream(messages, options = {}) {
  if (!config.geminiApiKey) {
    throw new ApiError(500, "Gemini API key not configured.");
  }

  const { temperature, maxTokens, model, thinking } = options;
  const modelName = model || config.geminiModel;
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

  const thinkingConfig = thinkingConfigFor(modelName, thinking);
  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 2048,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    }
  };

  if (systemMessage) {
    body.system_instruction = {
      parts: [{ text: systemMessage.content }]
    };
  }

  const send = (payload) => fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });

  try {
    let res = await send(body);
    let detail = res.ok ? "" : await res.text();
    // A model that won't take the thinking setting answers without it.
    if (res.status === 400 && thinkingConfig && /thinking/i.test(detail)) {
      logger.warn("geminiAdapter.thinkingConfigRejected", { model: modelName });
      const { thinkingConfig: _rejected, ...generationConfig } = body.generationConfig;
      res = await send({ ...body, generationConfig });
      detail = res.ok ? "" : await res.text();
    }

    if (!res.ok) {
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
  thinkingConfigFor,
};
