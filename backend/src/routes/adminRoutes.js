const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const asyncHandler = require("../middleware/asyncHandler");
const ApiError = require("../utils/apiError");
const moderation = require("../services/moderationService");
const admin = require("../controllers/adminController");

const router = express.Router();

// Signed in with Firebase, and listed in admins/{uid} (added by hand in the
// Firebase console — there is deliberately no way to make an admin from the
// app). Checked on the server for every request, whatever the page shows.
const requireAdmin = asyncHandler(async (req, _res, next) => {
  const fa = req.firebaseAuth;
  if (!fa?.uid || !(await moderation.isAdmin(fa.uid, fa.token))) {
    throw new ApiError(403, "Admins only.");
  }
  next();
});

router.use(authMiddleware, requireAdmin);

router.get("/status", asyncHandler(admin.status));
router.get("/users/:uid/account", asyncHandler(admin.account));
router.post("/users/:uid/disable", asyncHandler(admin.setDisabled));
router.post("/users/:uid/revoke", asyncHandler(admin.revokeSessions));

module.exports = router;
