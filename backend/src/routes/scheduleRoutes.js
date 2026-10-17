const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const optionalAuth = require("../middleware/optionalAuth");
const { chatLimiter } = require("../middleware/rateLimiters");
const controller = require("../controllers/scheduleController");

const router = express.Router();

router.post("/run-due", asyncHandler(controller.runDue));
router.get("/", optionalAuth, asyncHandler(controller.list));
router.post("/", chatLimiter, optionalAuth, asyncHandler(controller.create));
router.patch("/:id", chatLimiter, optionalAuth, asyncHandler(controller.update));
router.delete("/:id", chatLimiter, optionalAuth, asyncHandler(controller.remove));
router.post("/:id/run", chatLimiter, optionalAuth, asyncHandler(controller.runNow));
router.post("/:id/read", chatLimiter, optionalAuth, asyncHandler(controller.markRead));

module.exports = router;
