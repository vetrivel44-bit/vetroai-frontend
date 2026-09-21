const attachmentService = require("../services/attachmentService");
const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");

async function listAttachments(req, res) {
  const sessionId = String(req.query?.sessionId || "").trim();
  if (!sessionId) throw new ApiError(400, "sessionId is required");
  const attachments = await attachmentService.listForSession(req.user.id, sessionId);
  return successResponse(res, "Attachments retrieved", attachments);
}

async function deleteAttachment(req, res) {
  await attachmentService.remove(req.user.id, req.params.id);
  return successResponse(res, "Attachment deleted", null);
}

module.exports = { listAttachments, deleteAttachment };
