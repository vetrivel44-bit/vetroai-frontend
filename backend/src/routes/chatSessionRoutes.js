const express = require("express");
const controller = require("../controllers/chatSessionController");
const authMiddleware = require("../middleware/authMiddleware");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authMiddleware);

router.get("/", asyncHandler(controller.getSessions));
router.post("/", asyncHandler(controller.saveSession));
router.delete("/", asyncHandler(controller.clearSessions));
router.delete("/:id", asyncHandler(controller.deleteSession));

module.exports = router;
