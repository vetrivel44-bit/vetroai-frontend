const memoryService = require("../services/memoryService");
const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");

async function listMemories(req, res) {
  const memories = await memoryService.list(req.user.id);
  return successResponse(res, "Memories retrieved", memories);
}

async function addMemory(req, res) {
  const content = String(req.body?.content || "").trim();
  if (!content) throw new ApiError(400, "content is required");
  const memory = await memoryService.add(req.user.id, content, "manual");
  if (!memory) throw new ApiError(503, "Memory storage is unavailable right now.");
  return successResponse(res, "Memory saved", memory);
}

async function deleteMemory(req, res) {
  await memoryService.remove(req.user.id, req.params.id);
  return successResponse(res, "Memory deleted", null);
}

async function clearMemories(req, res) {
  await memoryService.clear(req.user.id);
  return successResponse(res, "All memories cleared", null);
}

module.exports = { listMemories, addMemory, deleteMemory, clearMemories };
