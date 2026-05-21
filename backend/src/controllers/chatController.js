const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { performDeepSearch } = require("../services/deepSearchService");

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
  medical:      "llama-3.3-70b-versatile",
  vision:       "llama-3.2-11b-vision-preview",
  code_exec:    "llama-3.3-70b-versatile",
  persona:      "llama-3.3-70b-versatile",
};

const aiGateway = require("../services/AIGateway");
const providerManager = require("../services/ProviderManager");

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

function normalizeModel(inputModel, provider) {
  const fallbackMap = {
    groq: "llama-3.1-8b-instant",      // 30K TPM — avoids rate limits on free tier
    gemini: "gemini-2.0-flash-exp",
    mistral: "mistral-small-latest",
    sambanova: "Meta-Llama-3.3-70B-Instruct"
  };
  
  const fallback = fallbackMap[provider?.toLowerCase()] || "llama-3.3-70b-versatile";
  if (!inputModel || inputModel.toLowerCase() === provider?.toLowerCase()) return fallback;
  return MODEL_ALIASES[inputModel] || inputModel;
}

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function routeByMode(mode) {
  return MODEL_ALIASES[mode] || "mistral";
}

function routeQuery(input, hasFile) {
  if (hasFile) return "vision";
  const low = input.toLowerCase();
  if (low.includes("code") || low.includes("python") || low.includes("js")) return "debugger";
  if (low.includes("search") || low.includes("find")) return "web_search";
  return "fast_chat";
}

function getAttachmentContext(file) {
  if (!file) return "";
  return `\n\n[Attached File: ${file.originalname}]\nContent preview or metadata would be parsed here.`;
}

function normalizeMessages(rawMessages, input) {
  let parsed = [];
  if (rawMessages) {
    if (typeof rawMessages === "string") {
      try { parsed = JSON.parse(rawMessages); }
      catch { throw new ApiError(400, "Invalid messages payload"); }
    } else if (Array.isArray(rawMessages)) {
      parsed = rawMessages;
    }
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

async function withRetry(operation, retries = 2, delay = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); }
    catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const isRateLimit = err.status === 429 || err.message?.includes("429") || err.message?.includes("Rate limit");
      if (isRateLimit) {
        logger.warn(`Rate limit hit, retrying in ${delay * (attempt + 1)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

const AIOrchestrator = require("../services/AIOrchestrator");

// ── MAIN CHAT HANDLER ─────────────────────────────────────────────────────────
async function chat(req, res) {
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const provider = req.body?.provider;
  const mode = req.body?.mode;
  const safeMode = String(req.body?.safeMode || "false") === "true";
  const temperature = Number(req.body?.temperature ?? 0.7);
  const maxTokens = Number(req.body?.maxTokens ?? 2048);
  
  // Basic input sanitization
  const input = sanitizePrompt(req.body?.input || "", safeMode);
  const messages = normalizeMessages(req.body?.messages, input);
  
  let memories = [];
  if (req.body?.memories) {
    try {
      memories = typeof req.body.memories === "string" ? JSON.parse(req.body.memories) : req.body.memories;
    } catch (e) { logger.warn("Failed to parse memories", { error: e.message }); }
  }

  // Custom system prompt from the frontend
  const systemPrompt = String(req.body?.systemPrompt || "").trim().slice(0, 2000);

  // Web search flag from frontend (autoWebSearch toggle or explicit web mode)
  const webSearch = String(req.body?.webSearch || "false") === "true";

  const attachmentContext = getAttachmentContext(req.file);
  if (attachmentContext) {
    messages.push({ role: "user", content: attachmentContext });
  }

  if (!messages.length) throw new ApiError(400, "No valid messages provided");

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Important for streaming proxies
  res.flushHeaders?.();

  const heartbeat = setInterval(() => { res.write(": ping\n\n"); }, 12000);
  const cleanup = () => { clearInterval(heartbeat); };

  try {
    await AIOrchestrator.processRequest(reqId, {
      messages,
      mode,
      provider,
      memories,
      systemPrompt,
      webSearch,
      options: { temperature, maxTokens }
    }, res);
  } catch (err) {
    logger.error("chat.request.failed", { reqId, error: err.message });
    // AIOrchestrator already tries to send an error event, but we ensure it's closed
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "error", data: "VetroAI is currently unreachable. Please check your connection." })}\n\n`);
    }
  } finally {
    cleanup();
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
        { role: "system", content: "Generate a 4-6 word summary title for this chat. Never use simple greetings like 'hi' or 'hello' as a title. Include a relevant emoji at the start. Return plain text only." },
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
        { role: "system", content: "Generate a 4-6 word summary title for this chat. Never use simple greetings like 'hi' or 'hello' as a title. Include a relevant emoji at the start. Return plain text only." },
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

  if (!groq && deepseekAvailable) {
    const completion = await callDeepSeekChat({
      model: config.deepseekModel,
      messages: [
        { role: "system", content: "Return exactly 4 concise follow-up questions as a JSON array of strings. No markdown, no extra keys." },
        { role: "user", content: `Original query: ${userQuery}\n\nAssistant answer: ${lastMessage.slice(0, 1400)}` },
      ],
      temperature: config.deepseekTemperature,
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

async function getHealth(req, res) {
  return res.json({
    backend: "online",
    providers: providerManager.getStats(),
    uptime: process.uptime(),
    version: "1.1.0",
    environment: process.env.NODE_ENV || "development"
  });
}

module.exports = { chat, generateTitle, followUps, getHealth };
