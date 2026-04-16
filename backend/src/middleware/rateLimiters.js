const rateLimit = require("express-rate-limit");
const { errorResponse } = require("../utils/response");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => errorResponse(res, "Too many auth attempts. Please try again later.", 429),
});

module.exports = {
  authLimiter,
};
