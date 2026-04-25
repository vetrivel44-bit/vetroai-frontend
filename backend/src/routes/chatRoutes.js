const express = require("express");
const multer = require("multer");
const asyncHandler = require("../middleware/asyncHandler");
// const authMiddleware = require("../middleware/authMiddleware");
const { chatLimiter } = require("../middleware/rateLimiters");
const chatController = require("../controllers/chatController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB for images/PDFs
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(txt|md|csv|json|js|ts|py|pdf|png|jpg|jpeg|gif|webp|bmp)$/i;
    cb(null, allowed.test(file.originalname) || file.mimetype.startsWith("image/") || file.mimetype === "application/pdf");
  },
});

router.post("/chat", chatLimiter, upload.single("file"), asyncHandler(chatController.chat));
router.post("/generate-title", chatLimiter, asyncHandler(chatController.generateTitle));
router.post("/follow-ups", chatLimiter, asyncHandler(chatController.followUps));

module.exports = router;
