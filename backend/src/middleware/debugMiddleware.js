const logger = require("../utils/logger");

// Anything that would hand over an account (or an upstream API bill) if the log
// were ever shared, shipped to a log aggregator, or pasted into an issue.
const REDACTED = "[redacted]";
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-rapidapi-key",
  "stripe-signature",
]);
const SENSITIVE_BODY_FIELDS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "clientsecret",
]);

function redactHeaders(headers) {
  const safe = {};
  for (const [key, value] of Object.entries(headers || {})) {
    safe[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return safe;
}

function redactBody(body, depth = 0) {
  if (!body || typeof body !== "object" || depth > 4) return body;
  if (Array.isArray(body)) return body.map((item) => redactBody(item, depth + 1));
  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    safe[key] = SENSITIVE_BODY_FIELDS.has(key.toLowerCase())
      ? REDACTED
      : redactBody(value, depth + 1);
  }
  return safe;
}

const debugMiddleware = (req, res, next) => {
  const reqId = req.headers["x-request-id"] || req.body?.reqId || `req_${Date.now()}`;

  logger.info("Debug.request.incoming", {
    reqId,
    method: req.method,
    url: req.url,
    headers: redactHeaders(req.headers),
    body: req.method !== "GET" ? redactBody(req.body) : undefined,
  });

  next();
};

module.exports = debugMiddleware;
module.exports.redactHeaders = redactHeaders;
module.exports.redactBody = redactBody;
