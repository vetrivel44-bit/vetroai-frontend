const mongoose = require("mongoose");
const Memory = require("../models/Memory");
const embeddingService = require("./embeddingService");
const logger = require("../utils/logger");

function isDbAvailable() {
  return mongoose.connection.readyState === 1;
}

function isResolvableUserId(userId) {
  return Boolean(userId) && mongoose.isValidObjectId(userId);
}

// Caps how many of a user's memories are ever pulled into a single ranking
// pass — a heavy user could accumulate thousands over time, and re-embedding
// or re-scoring all of them on every message would make chat slower the
// longer someone uses the product, which is exactly backwards.
const MAX_MEMORIES_SCANNED = 300;
const DEFAULT_TOP_K = 5;
const MIN_SIMILARITY = 0.3;

// Cheap heuristic for "this message is worth remembering" — avoids spending
// an embedding + write on every single turn, which would both cost money and
// bury real preferences under small talk.
const MEMORABLE_RE = /\b(my name is|i'?m|i am|i live in|i work (as|at)|i prefer|i like|i love|i hate|i don'?t like|remember (that|this)|call me|my (favorite|favourite|job|role|company|timezone|birthday)|please (always|never))\b/i;

function isMemorable(text) {
  return typeof text === "string" && text.length >= 8 && text.length <= 400 && MEMORABLE_RE.test(text);
}

async function add(userId, content, source = "manual") {
  if (!isDbAvailable() || !isResolvableUserId(userId)) return null;
  const clean = String(content || "").trim().slice(0, 500);
  if (!clean) return null;

  const embeddings = await embeddingService.embed([clean], "search_document");
  const embedding = embeddings?.[0] || [];

  try {
    return await Memory.create({ userId, content: clean, embedding, source });
  } catch (err) {
    logger.warn("memoryService.add.failed", { error: err.message });
    return null;
  }
}

// Fire-and-forget from the chat flow — never let a memory-extraction hiccup
// slow down or break an answer that's already been sent to the user.
function captureFromMessage(userId, text) {
  if (!isDbAvailable() || !isResolvableUserId(userId) || !isMemorable(text)) return;
  add(userId, text, "auto").catch((err) => logger.warn("memoryService.capture.failed", { error: err.message }));
}

async function retrieveRelevant(userId, queryText, topK = DEFAULT_TOP_K) {
  if (!isDbAvailable() || !isResolvableUserId(userId) || !embeddingService.isAvailable()) return [];
  const query = String(queryText || "").trim();
  if (!query) return [];

  try {
    const candidates = await Memory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(MAX_MEMORIES_SCANNED)
      .lean();
    if (!candidates.length) return [];

    const [queryEmbedding] = await embeddingService.embed([query], "search_query") || [];
    if (!queryEmbedding) return [];

    return candidates
      .map((m) => ({ content: m.content, score: embeddingService.cosineSimilarity(queryEmbedding, m.embedding) }))
      .filter((m) => m.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((m) => m.content);
  } catch (err) {
    logger.warn("memoryService.retrieve.failed", { error: err.message });
    return [];
  }
}

async function list(userId) {
  if (!isDbAvailable() || !isResolvableUserId(userId)) return [];
  return Memory.find({ userId }).sort({ createdAt: -1 }).limit(500);
}

async function remove(userId, memoryId) {
  if (!isDbAvailable() || !isResolvableUserId(userId)) return;
  await Memory.findOneAndDelete({ _id: memoryId, userId });
}

async function clear(userId) {
  if (!isDbAvailable() || !isResolvableUserId(userId)) return;
  await Memory.deleteMany({ userId });
}

module.exports = { add, captureFromMessage, retrieveRelevant, list, remove, clear };
