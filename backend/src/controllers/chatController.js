const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { normalizePluginIds } = require("../config/plugins");
const { performDeepSearch } = require("../services/deepSearchService");

// ── Groq client ───────────────────────────────────────────────────────────────
if (!config.groqApiKey) {
  logger.warn("chatController.init", { note: "GROQ_API_KEY not set — chat requests will fail." });
}
const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
const mistralAvailable = Boolean(config.mistralApiKey);

const providerManager = require("../services/ProviderManager");
const creditService = require("../services/creditService");
const medicalService = require("../services/medicalService");
const { verifyAccessToken } = require("../utils/token");

// Best-effort: resolves a Mongo user id from the bearer token if one is present.
// Never throws — chat must keep working for offline/local-mode users with no DB account.
function resolveBillingUserId(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.startsWith("local_")) return null;
  try {
    const decoded = verifyAccessToken(token);
    return decoded?.userId || null;
  } catch {
    return null;
  }
}

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
    return null; // Browser clients analyze images directly with Puter GPT-5.6 Luna.
  }
  const text = file.buffer.toString("utf-8").trim();
  if (!text) return null;
  return `Attached file (${file.originalname}):\n${text.slice(0, 12000)}`;
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

async function callMistralChat({ messages, temperature = 0.4, maxTokens = 120 }) {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mistralApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.mistralModel || "mistral-small-latest",
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, `Mistral service error: ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── MAIN CHAT HANDLER ─────────────────────────────────────────────────────────
async function chat(req, res) {
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const provider = req.body?.provider;
  const mode = req.body?.mode;
  const safeMode = String(req.body?.safeMode || "false") === "true";
  const temperature = Number(req.body?.temperature ?? 0.7);
  const maxTokens = Number(req.body?.maxTokens ?? 2048);
  // Drives how deep the streamed <think> block goes (see AIOrchestrator.buildThinkingPrompt).
  const effort = String(req.body?.effort || "balanced").slice(0, 16);
  
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
  const activePlugins = normalizePluginIds(req.body?.plugins);

  // Web search flag from frontend (autoWebSearch toggle or explicit web mode)
  const webSearch = String(req.body?.webSearch || "false") === "true";

  const files = [
    ...(req.files?.files || []),
    ...(req.files?.file || []),
    ...(req.file ? [req.file] : []),
  ];
  const imageFiles = files.filter(f => f.mimetype.startsWith("image/"));
  const textFiles = files.filter(f => !f.mimetype.startsWith("image/"));
  if (files.length > 0) {
    logger.info("chat.attachments", { count: files.length, images: imageFiles.length, text: textFiles.length });
  }
  for (const file of textFiles) {
    const attachmentContext = getAttachmentContext(file);
    if (attachmentContext) {
      messages.push({ role: "user", content: attachmentContext });
    }
  }

  if (!messages.length) throw new ApiError(400, "No valid messages provided");

  const billingUserId = resolveBillingUserId(req);

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  if (billingUserId && creditService.isDbAvailable()) {
    const status = await creditService.getBillingStatus(billingUserId);
    if (status && status.plan === "free" && typeof status.credits === "number" && status.credits <= 0) {
      res.write(`data: ${JSON.stringify({ type: "error", data: "You've used all your free credits for this period. Upgrade your plan to keep chatting.", code: "INSUFFICIENT_CREDITS" })}\n\n`);
      return res.end();
    }
  }

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
      activePlugins,
      effort,
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
    if (billingUserId) {
      creditService.consumeCredit(billingUserId, 1, "chat_message", { reqId, mode, provider }).catch(() => {});
    }
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

  if (!groq) {
    const title = firstMessage
      .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(" ")
      .slice(0, 64) || "New Chat";
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

  try {
  if (!groq && mistralAvailable) {
    const completion = await callMistralChat({
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

  if (!groq) {
    return successResponse(res, "No follow-ups available", { suggestions: [] });
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
  } catch (error) {
    logger.warn("chat.followUps.failed", { error: error.message });
    return successResponse(res, "Follow-ups unavailable", { suggestions: [] });
  }
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

async function medicalAnswer(req, res) {
  const query = String(req.body?.query || "").trim();
  if (!query) throw new ApiError(400, "query is required");
  const specialization = String(req.body?.specialization || "general medicine").slice(0, 60);
  const language = String(req.body?.language || "en").slice(0, 10);

  const result = await medicalService.fetchMedicalAnswer(query, specialization, language);
  if (!result) return successResponse(res, "No medical data available", null);
  return successResponse(res, "Medical answer generated", result);
}

async function textToSpeech(req, res) {
  const text = String(req.body?.text || "").trim();
  if (!text) throw new ApiError(400, "text is required");
  const voice = String(req.body?.voice || "en-US-JennyNeural").slice(0, 40);

  const { buffer, contentType } = await medicalService.synthesizeSpeech(text.slice(0, 2000), voice);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", buffer.length);
  return res.send(buffer);
}

module.exports = { chat, generateTitle, followUps, getHealth, medicalAnswer, textToSpeech };
