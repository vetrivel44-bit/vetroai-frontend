const ChatSession = require("../models/ChatSession");
const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");

const mongoose = require("mongoose");
function isDbAvailable() { return mongoose.connection.readyState === 1; }
function shouldSkip(req) { return !isDbAvailable() || req.user?.isOffline; }

async function getSessions(req, res) {
  if (shouldSkip(req)) return successResponse(res, "Offline mode", []);
  const sessions = await ChatSession.find({ userId: req.user.id }).sort({ updatedAt: -1 });
  return successResponse(res, "Sessions retrieved", sessions.map(s => ({
    id: s.sessionId,
    title: s.title,
    messages: s.messages,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  })));
}

async function saveSession(req, res) {
  if (shouldSkip(req)) return successResponse(res, "Offline mode", null);
  const { id, title, messages } = req.body;
  if (!id) throw new ApiError(400, "Session id is required");

  const session = await ChatSession.findOneAndUpdate(
    { sessionId: id, userId: req.user.id },
    { title, messages },
    { new: true, upsert: true }
  );
  return successResponse(res, "Session saved", session);
}

async function deleteSession(req, res) {
  if (shouldSkip(req)) return successResponse(res, "Offline mode", null);
  const { id } = req.params;
  await ChatSession.findOneAndDelete({ sessionId: id, userId: req.user.id });
  return successResponse(res, "Session deleted", null);
}

async function clearSessions(req, res) {
  if (shouldSkip(req)) return successResponse(res, "Offline mode", null);
  await ChatSession.deleteMany({ userId: req.user.id });
  return successResponse(res, "All sessions cleared", null);
}

module.exports = { getSessions, saveSession, deleteSession, clearSessions };
