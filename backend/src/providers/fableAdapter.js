const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

function extractFableText(payload) {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";

  if (Array.isArray(payload)) {
    return payload.map(extractFableText).filter(Boolean).join("\n").trim();
  }

  const choicesText = extractFableText(payload.choices?.[0]?.message?.content)
    || extractFableText(payload.choices?.[0]?.text);
  if (choicesText) return choicesText;

  for (const key of ["result", "response", "answer", "message", "content", "output", "text", "completion", "data"]) {
    if (payload[key] === undefined) continue;
    const text = extractFableText(payload[key]);
    if (text) return text;
  }

  return "";
}

function buildFablePrompt(messages) {
  const transcript = messages
    .filter((message) => message?.role !== "system" && typeof message?.content === "string" && message.content.trim())
    .slice(-12)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content.trim()}`)
    .join("\n\n");

  return transcript ? `${transcript}\n\nAssistant:` : "";
}

async function* generateStream(messages) {
  if (!config.fableRapidApiKey) {
    throw new ApiError(500, "Claude Fable 5 API key is not configured.");
  }

  const systemMessage = messages.find((message) => message?.role === "system");
  const prompt = buildFablePrompt(messages);
  if (!prompt) {
    throw new ApiError(400, "Claude Fable 5 requires a text prompt.");
  }

  try {
    const response = await fetch(config.fableApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": config.fableApiHost,
        "x-rapidapi-key": config.fableRapidApiKey,
      },
      body: JSON.stringify({
        operation: "message",
        system: systemMessage?.content || "You are a helpful assistant.",
        prompt,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new ApiError(
        response.status,
        `Claude Fable 5 service error: ${response.status} ${detail.slice(0, 200)}`
      );
    }

    const raw = await response.text();
    let payload = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Some RapidAPI responses are plain text.
    }

    const content = extractFableText(payload);
    if (!content) {
      throw new Error("Claude Fable 5 returned an empty response.");
    }

    const chunks = content.split(/(?<=\s)/);
    for (let index = 0; index < chunks.length; index += 4) {
      yield { text: chunks.slice(index, index + 4).join("") };
    }
  } catch (error) {
    logger.error("fableAdapter.generateStream", {
      error: error.message,
      status: error.statusCode || error.status,
    });
    throw error;
  }
}

module.exports = {
  buildFablePrompt,
  extractFableText,
  generateStream,
};
