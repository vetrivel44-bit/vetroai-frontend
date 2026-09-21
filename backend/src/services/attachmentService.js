const mongoose = require("mongoose");
const Attachment = require("../models/Attachment");
const logger = require("../utils/logger");

function isDbAvailable() {
  return mongoose.connection.readyState === 1;
}

function isResolvableUserId(userId) {
  return Boolean(userId) && mongoose.isValidObjectId(userId);
}

// How many persisted attachments' worth of text get folded into a single
// prompt. Everything is already capped per-file (see extractedText maxlength
// on the model); this bounds the total so an old session with a dozen
// uploads doesn't crowd out the actual conversation.
const MAX_ATTACHMENTS_IN_PROMPT = 5;

async function persist(userId, sessionId, file, extractedText) {
  if (!isDbAvailable() || !isResolvableUserId(userId) || !sessionId) return null;
  if (!extractedText || !extractedText.trim()) return null;

  try {
    return await Attachment.create({
      userId,
      sessionId,
      filename: file.originalname,
      mimeType: file.mimetype,
      extractedText: extractedText.slice(0, 20000),
    });
  } catch (err) {
    logger.warn("attachmentService.persist.failed", { error: err.message });
    return null;
  }
}

// Called on every chat turn so later messages in a session can reference a
// file that was only attached once, instead of the user having to re-upload
// it each time (the previous behavior — see AIOrchestrator's per-message
// `images` field for the vision equivalent, which is one-off by design).
async function contextForSession(userId, sessionId) {
  if (!isDbAvailable() || !isResolvableUserId(userId) || !sessionId) return [];
  try {
    const attachments = await Attachment.find({ userId, sessionId })
      .sort({ createdAt: -1 })
      .limit(MAX_ATTACHMENTS_IN_PROMPT)
      .lean();
    return attachments.reverse().map(
      (a) => `Attached file from earlier in this chat (${a.filename}):\n${a.extractedText}`
    );
  } catch (err) {
    logger.warn("attachmentService.contextForSession.failed", { error: err.message });
    return [];
  }
}

async function listForSession(userId, sessionId) {
  if (!isDbAvailable() || !isResolvableUserId(userId) || !sessionId) return [];
  return Attachment.find({ userId, sessionId }).sort({ createdAt: -1 });
}

async function remove(userId, attachmentId) {
  if (!isDbAvailable() || !isResolvableUserId(userId)) return;
  await Attachment.findOneAndDelete({ _id: attachmentId, userId });
}

module.exports = { persist, contextForSession, listForSession, remove };
