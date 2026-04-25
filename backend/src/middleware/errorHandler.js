const { ZodError } = require("zod");
const multer = require("multer");
const { errorResponse } = require("../utils/response");
const logger = require("../utils/logger");

function notFoundHandler(req, res) {
  return errorResponse(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let details = err.details || null;

  if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation failed";
    details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  }

  if (err instanceof multer.MulterError) {
    statusCode = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large" : "Invalid file upload";
  }

  logger.error("request.error", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    message,
  });

  return errorResponse(res, message, statusCode, details);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
