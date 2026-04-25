const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");

// ── Groq client ───────────────────────────────────────────────────────────────
if (!config.groqApiKey) {
  logger.warn("chatController.init", { note: "GROQ_API_KEY not set — chat requests will fail." });
}
const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
const mistralAvailable = Boolean(config.mistralApiKey);

const MODEL_ALIASES = {
  fast_chat:    "llama-3.1-8b-instant",
  vtu_academic: "llama-3.3-70b-versatile",
  debugger:     "llama-3.3-70b-versatile",
  creative:     "llama-3.3-70b-versatile",
  analyst:      "llama-3.3-70b-versatile",
  web_search:   "llama-3.1-8b-instant",
  deep_search:  "llama-3.3-70b-versatile",
  youtube:      "llama-3.3-70b-versatile",
  translator:   "llama-3.3-70b-versatile",
  interviewer:  "llama-3.3-70b-versatile",
  astrology:    "llama-3.1-8b-instant",
  vision:       "llama-3.2-11b-vision-preview",
  code_exec:    "llama-3.3-70b-versatile",
  persona:      "llama-3.3-70b-versatile",
};

const SAFE_PATTERNS = [
  /ignore (all|previous|prior) instructions/gi,
  /reveal (system|hidden) prompt/gi,
  /developer instructions/gi,
];

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "text/plain", "text/markdown", "text/csv",
  "application/json", "application/javascript",
  "application/pdf", "application/x-pdf",
]);

function normalizeModel(inputModel) {
  const fallback = config.groqModel || "llama-3.3-70b-versatile";
  if (!inputModel) return fallback;
  return MODEL_ALIASES[inputModel] || inputModel;
}

function normalizeMessages(rawMessages, input) {
  let parsed = [];
  if (rawMessages) {
    try { parsed = JSON.parse(rawMessages); }
    catch { throw new ApiError(400, "Invalid messages payload"); }
  }
  if (!Array.isArray(parsed)) parsed = [];
  const clean = parsed
    .filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
    .slice(-18)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));

  if (input && typeof input === "string" && input.trim()) {
    const last = clean[clean.length - 1];
    if (!last || last.role !== "user" || last.content.trim() !== input.trim()) {
      clean.push({ role: "user", content: input.trim().slice(0, 12000) });
    }
  }
  return clean;
}

function sanitizePrompt(input, safeMode) {
  if (!safeMode || !input) return input;
  let out = input;
  SAFE_PATTERNS.forEach((pattern) => { out = out.replace(pattern, "[filtered]"); });
  return out;
}

function getAttachmentContext(file) {
  if (!file) return null;
  const isTextLike = file.mimetype.startsWith("text/") || ALLOWED_ATTACHMENT_TYPES.has(file.mimetype);
  if (!isTextLike && !file.mimetype.startsWith("image/")) {
    throw new ApiError(400, "Unsupported attachment type. Use txt, md, csv, json, pdf, or images.");
  }
  if (file.mimetype.startsWith("image/")) {
    return `[IMAGE ATTACHED: ${file.originalname} (${Math.round(file.size / 1024)}KB)]\nPlease describe or analyze this image as requested by the user.`;
  }
  const text = file.buffer.toString("utf-8").trim();
  if (!text) return null;
  return `Attached file (${file.originalname}):\n${text.slice(0, 12000)}`;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function withRetry(operation, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); }
    catch (err) { lastErr = err; if (attempt === retries) break; }
  }
  throw lastErr;
}

async function callMistralChat({ messages, temperature, maxTokens, model }) {
  if (!mistralAvailable) throw new Error("Mistral API key not configured.");
  const endpoint = "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mistralApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`Mistral service error: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
}

// ── MAIN CHAT HANDLER ─────────────────────────────────────────────────────────
async function chat(req, res) {
  const startedAt = Date.now();
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const model = normalizeModel(req.body?.model);
  const safeMode = String(req.body?.safeMode || "false") === "true";
  const temperature = Number(req.body?.temperature ?? config.groqTemperature);
  const rawMax = Number(req.body?.maxTokens ?? config.groqMaxTokens);
  const maxTokens = Math.min(rawMax, 8192);
  const input = sanitizePrompt(req.body?.input || "", safeMode);
  const messages = normalizeMessages(req.body?.messages, input);
  const attachmentContext = getAttachmentContext(req.file);
  if (attachmentContext) messages.push({ role: "user", content: attachmentContext });

  if (!messages.length) throw new ApiError(400, "No valid messages provided");

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 12000);
  const cleanup = () => { clearInterval(heartbeat); };

  // Check AI availability
  if (!groq && !mistralAvailable) {
    cleanup();
    sseWrite(res, { content: "⚠️ AI service not configured. Please set GROQ_API_KEY or MISTRAL_API_KEY in the backend .env file and restart the server." });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  logger.info("chat.request.started", {
    reqId, userId: req.user?.id || "anon", model,
    messages: messages.length, hasAttachment: Boolean(req.file),
    provider: "Groq",
  });

  try {
    const stream = await withRetry(
      () => groq.chat.completions.create({
        model,
        messages,
        temperature: Number.isFinite(temperature) ? temperature : config.groqTemperature,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : config.groqMaxTokens,
        stream: true,
      }),
      1
    );

    let tokenCount = 0;
    for await (const chunk of stream) {
      const content = chunk?.choices?.[0]?.delta?.content || "";
      if (!content) continue;
      tokenCount++;
      sseWrite(res, { content });
    }

    res.write("data: [DONE]\n\n");
    res.end();
    cleanup();
    logger.info("chat.request.completed", {
      reqId, model, streamChunks: tokenCount, latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (mistralAvailable) {
      try {
        const fallbackModel = config.mistralModel || model;
        const fallbackTemp = Number.isFinite(temperature) ? temperature : config.mistralTemperature;
        const fallbackMax = Number.isFinite(maxTokens) ? maxTokens : config.mistralMaxTokens;
        const output = await callMistralChat({ messages, temperature: fallbackTemp, maxTokens: fallbackMax, model: fallbackModel });
        sseWrite(res, { content: output });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        logger.info("chat.request.completed", {
          reqId, model: fallbackModel, provider: "Mistral", latencyMs: Date.now() - startedAt,
        });
        return;
      } catch (merr) {
        logger.error("chat.request.failed.mistral", { reqId, model: config.mistralModel, message: merr.message, status: merr.status });
      }
    }
    cleanup();
    logger.error("chat.request.failed", { reqId, model, message: err.message, status: err.status });

    // Send a descriptive error back via SSE so frontend shows it clearly
    let errMsg = "\n\n⚠️ **AI Error**: ";
    if (err.status === 429) {
      errMsg += "Rate limit reached. Please wait a moment and try again.";
    } else if (err.status === 401) {
      errMsg += "Invalid Groq API key. Please check GROQ_API_KEY in your .env file.";
    } else if (err.status === 503 || err.message?.includes("timeout")) {
      errMsg += "Groq service is temporarily unavailable. Please try again in a moment.";
    } else {
      errMsg += "Groq service error. Please try again.";
    }

    sseWrite(res, { content: errMsg });
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

async function generateTitle(req, res) {
  const firstMessage = String(req.body?.firstMessage || "").trim();
  if (!firstMessage) throw new ApiError(400, "firstMessage is required");

  if (!groq && mistralAvailable) {
    const completion = await callMistralChat({
      model: config.mistralModel,
      messages: [
        { role: "system", content: "Generate a short chat title with max 6 words. Include a relevant emoji at start. Return plain text only." },
        { role: "user", content: firstMessage.slice(0, 400) },
      ],
      temperature: config.mistralTemperature,
      maxTokens: 28,
    });
    const title = completion.trim().replace(/^["']|["']$/g, "").slice(0, 64) || "New Chat";
    return successResponse(res, "Title generated", { title });
  }

  const completion = await withRetry(
    () => groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.2, max_tokens: 28,
      messages: [
        { role: "system", content: "Generate a short chat title with max 6 words. Include a relevant emoji at start. Return plain text only." },
        { role: "user", content: firstMessage.slice(0, 400) },
      ],
    }),
    1
  );

  const title = completion?.choices?.[0]?.message?.content?.trim() || "New Chat";
  return successResponse(res, "Title generated", { title: title.replace(/^[\"']|[\"']$/g, "").slice(0, 64) });
}

async function followUps(req, res) {
  const lastMessage = String(req.body?.lastMessage || "").trim();
  const userQuery = String(req.body?.userQuery || "").trim();
  if (!lastMessage) throw new ApiError(400, "lastMessage is required");

  if (!groq && mistralAvailable) {
    const completion = await callMistralChat({
      model: config.mistralModel,
      messages: [
        { role: "system", content: "Return exactly 4 concise follow-up questions as a JSON array of strings. No markdown, no extra keys." },
        { role: "user", content: `Original query: ${userQuery}\n\nAssistant answer: ${lastMessage.slice(0, 1400)}` },
      ],
      temperature: config.mistralTemperature,
      maxTokens: 120,
    });
    let suggestions = [];
    try {
      const parsed = JSON.parse(completion);
      if (Array.isArray(parsed)) suggestions = parsed.filter((x) => typeof x === "string").slice(0, 4);
    } catch {
      suggestions = completion.split(/\n+/).map((l) => l.replace(/^[\-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4);
    }
    return successResponse(res, "Follow-ups generated", { suggestions });
  }

  const completion = await withRetry(
    () => groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.5, max_tokens: 120,
      messages: [
        { role: "system", content: "Return exactly 4 concise follow-up questions as a JSON array of strings. No markdown, no extra keys." },
        { role: "user", content: `Original query: ${userQuery}\n\nAssistant answer: ${lastMessage.slice(0, 1400)}` },
      ],
    }),
    1
  );

  const raw = completion?.choices?.[0]?.message?.content || "[]";
  let suggestions = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) suggestions = parsed.filter((x) => typeof x === "string").slice(0, 4);
  } catch {
    suggestions = raw.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4);
  }

  return successResponse(res, "Follow-ups generated", { suggestions });
}

module.exports = { chat, generateTitle, followUps };
