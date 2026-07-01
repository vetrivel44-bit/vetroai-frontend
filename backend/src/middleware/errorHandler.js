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
    const multerMessages = {
      LIMIT_FILE_SIZE: "Uploaded file is too large (max 20MB)",
      LIMIT_FILE_COUNT: "Too many files (max 10)",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field name",
      LIMIT_FIELD_KEY: "Field name too long",
      LIMIT_FIELD_VALUE: "Field value too long",
      LIMIT_PART_COUNT: "Too many parts",
    };
    message = multerMessages[err.code] || `File upload error: ${err.code}`;
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
