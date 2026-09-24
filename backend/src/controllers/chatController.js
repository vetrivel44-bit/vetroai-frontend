const Groq = require("groq-sdk");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { normalizePluginIds } = require("../config/plugins");

// ── Groq client ───────────────────────────────────────────────────────────────
if (!config.groqApiKey) {
  logger.warn("chatController.init", { note: "GROQ_API_KEY not set — chat requests will fail." });
}
// Each image rides along as base64 in the request body, so a whole album would
// bloat every fallback attempt. Enough for a normal "look at these" turn.
const MAX_VISION_IMAGES = 4;

const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
const mistralAvailable = Boolean(config.mistralApiKey);

const providerManager = require("../services/ProviderManager");
const creditService = require("../services/creditService");
const { withGroqModel } = require("../utils/groqModel");
const medicalService = require("../services/medicalService");
const followUpService = require("../services/followUpService");
const { clientClock } = require("../services/clockService");
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
  // 18 messages (9 exchanges) was cutting real conversations short — anything
  // said earlier in a longer chat just fell out of context and the model
  // looked like it "forgot". 50 keeps a much longer conversation in view
  // while staying well inside every provider's context window at the 12000
  // char/message cap below.
  const clean = parsed
    .filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
    .slice(-50)
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
    return null; // Images travel on the message itself (see `images` below).
  }
  // A PDF's raw bytes are not text: decoding them as UTF-8 handed the model
  // pages of binary noise. The web app converts PDFs to text before sending;
  // anything still binary here is reported plainly instead.
  const head = file.buffer.subarray(0, 4096);
  const isBinary = file.buffer.subarray(0, 5).toString("latin1") === "%PDF-" || head.includes(0);
  if (isBinary) {
    return `[The user attached "${file.originalname}", but its text could not be extracted here (it is a binary or scanned file). Say so and ask them to paste the text or attach it as an image.]`;
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

  // The user's own clock (IANA timezone from the browser), so "today" is
  // their today — see clockService.
  const clock = clientClock(req.body);

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
  // File text goes into the user's own message, ahead of their question. As a
  // separate trailing message it became "the latest question" (search and
  // intent checks ran on the file's text) and left the actual question behind it.
  const attachmentBlocks = textFiles.map(getAttachmentContext).filter(Boolean);
  if (attachmentBlocks.length) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      lastUser.content = `${attachmentBlocks.join("\n\n")}\n\nUser's question about the file${attachmentBlocks.length > 1 ? "s" : ""}: ${lastUser.content || "Summarise it."}`;
    } else {
      messages.push({ role: "user", content: attachmentBlocks.join("\n\n") });
    }
  }

  // Images are passed to the model itself rather than turned into text (see
  // getAttachmentContext, which returns null for them). Normal chat usually
  // analyses them client-side with Puter and never gets here, but when Puter
  // runs out of credits the browser falls through to this endpoint with the
  // images attached — so they have to survive for any mode, not just
  // computer_use, or the fallback answers about a picture it cannot see.
  //
  // The gemini and cohere adapters read this field; the rest are text-only,
  // which is why AIOrchestrator routes an image-carrying request to one of
  // those two.
  if (imageFiles.length) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      // One screenshot per screen-control step; a few for a normal chat turn,
      // capped because each one is inlined as base64 in the request body.
      const limit = mode === "computer_use" ? 1 : MAX_VISION_IMAGES;
      lastUser.images = imageFiles.slice(0, limit).map((file) => ({
        mimeType: file.mimetype,
        data: file.buffer.toString("base64"),
      }));
      if (imageFiles.length > limit) {
        // Said plainly so the reply can't claim to have looked at all of them.
        lastUser.content = `${lastUser.content || ""}\n\n[ONLY THE FIRST ${limit} OF ${imageFiles.length} ATTACHED IMAGES WERE SENT TO YOU. Say so rather than describing the ones you did not receive.]`.trim();
      }
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

  let answered = false;
  try {
    answered = await AIOrchestrator.processRequest(reqId, {
      messages,
      mode,
      provider,
      memories,
      systemPrompt,
      webSearch,
      clock,
      hasAttachments: files.length > 0,
      activePlugins,
      effort,
      options: { temperature, maxTokens }
    }, res) === true;
  } catch (err) {
    logger.error("chat.request.failed", { reqId, error: err.message });
    // AIOrchestrator already tries to send an error event, but we ensure it's closed
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "error", data: "VetroAI is currently unreachable. Please check your connection." })}\n\n`);
    }
  } finally {
    cleanup();
    // Only bill a turn that actually produced an answer — a request that
    // exhausted every provider, or failed outright, is free.
    if (billingUserId && answered) {
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
  // Recent turns let the model avoid re-asking something already covered.
  let history = [];
  if (req.body?.history) {
    try {
      const parsed = typeof req.body.history === "string" ? JSON.parse(req.body.history) : req.body.history;
      if (Array.isArray(parsed)) {
        history = parsed
          .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
      }
    } catch { /* history is a nicety, not a requirement */ }
  }

  if (!lastMessage) throw new ApiError(400, "lastMessage is required");

  // Whichever provider is configured, called through one interface so the
  // prompt and the cleanup are identical for both.
  let callModel = null;
  if (groq) {
    callModel = async ({ system, user, maxTokens, temperature }) => {
      const completion = await withRetry(
        // A stronger model than llama-3.1-8b-instant: the questions are the
        // whole point, and the weaker one reached for templates.
        () => withGroqModel(groq, config.groqFollowUpModel || "llama-3.3-70b-versatile", (model) => groq.chat.completions.create({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        })),
        1
      );
      return completion?.choices?.[0]?.message?.content || "";
    };
  } else if (mistralAvailable) {
    callModel = async ({ system, user, maxTokens, temperature }) => callMistralChat({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature,
      maxTokens,
    });
  }

  if (!callModel) {
    return successResponse(res, "No follow-ups available", { suggestions: [] });
  }

  try {
    const suggestions = await followUpService.generateFollowUps({
      userQuery,
      answer: lastMessage,
      history,
      callModel,
    });
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

module.exports = { chat, generateTitle, followUps, getHealth, medicalAnswer, textToSpeech, getAttachmentContext };
