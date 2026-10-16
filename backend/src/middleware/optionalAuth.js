const authMiddleware = require("./authMiddleware");

// Identifies the caller when a valid token is sent, and lets everyone else
// through as a visitor (req.user = null) instead of rejecting them — chat
// works signed out, but usage limits need to know whose usage it is.
function optionalAuth(req, res, next) {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  authMiddleware(req, res, (err) => {
    if (err) req.user = null;
    next();
  });
}

module.exports = optionalAuth;
