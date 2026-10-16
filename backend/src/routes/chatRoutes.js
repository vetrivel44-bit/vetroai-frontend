const express = require("express");
const multer = require("multer");
const asyncHandler = require("../middleware/asyncHandler");
const optionalAuth = require("../middleware/optionalAuth");
// const authMiddleware = require("../middleware/authMiddleware");
const { chatLimiter } = require("../middleware/rateLimiters");
const logger = require("../utils/logger");
const chatController = require("../controllers/chatController");
const searchController = require("../controllers/searchController");
const videoController = require("../controllers/videoController");
const youtubeController = require("../controllers/youtubeController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 }, // 20MB files, 5MB fields
  // No type filter: a dropped file used to vanish without a word. The
  // controller reads what is text and reports what isn't (getAttachmentContext).
});

router.get("/health", asyncHandler(chatController.getHealth));
const handleUpload = (req, res, next) => {
  const multerMiddleware = upload.fields([{ name: "files", maxCount: 10 }, { name: "file", maxCount: 1 }]);
  multerMiddleware(req, res, (err) => {
    if (err) {
      logger.warn("chat.upload.error", { code: err.code, message: err.message, field: err.field });
      return res.status(400).json({ success: false, message: `Upload error: ${err.code || err.message}` });
    }
    next();
  });
};
router.post("/chat", chatLimiter, handleUpload, optionalAuth, asyncHandler(chatController.chat));
router.post("/generate-title", chatLimiter, asyncHandler(chatController.generateTitle));
router.post("/follow-ups", chatLimiter, asyncHandler(chatController.followUps));
router.post("/search", chatLimiter, asyncHandler(searchController.performSearch));
// DeepSearch for browser models: the research itself, streamed (researchController.js).
router.post("/research", chatLimiter, asyncHandler(require("../controllers/researchController").research));
router.post("/generate-video", chatLimiter, asyncHandler(videoController.generateVideo));
router.get("/video-status/:videoId", asyncHandler(videoController.checkVideoStatus));
// Lets the browser open a playing video directly instead of a search page it
// would need the user to click through.
router.get("/youtube/resolve", chatLimiter, asyncHandler(youtubeController.resolveFirstVideo));
router.post("/medical-answer", chatLimiter, asyncHandler(chatController.medicalAnswer));
router.post("/tts", chatLimiter, asyncHandler(chatController.textToSpeech));

module.exports = router;
