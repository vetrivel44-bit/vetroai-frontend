const express = require("express");
const multer = require("multer");
const asyncHandler = require("../middleware/asyncHandler");
// const authMiddleware = require("../middleware/authMiddleware");
const { chatLimiter } = require("../middleware/rateLimiters");
const logger = require("../utils/logger");
const chatController = require("../controllers/chatController");
const searchController = require("../controllers/searchController");
const imageController = require("../controllers/imageController");
const videoController = require("../controllers/videoController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 }, // 20MB files, 5MB fields
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") return cb(null, true);
    const allowed = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|cpp|c|rb|go|rs|php|sql|yaml|yml|xml|html|pdf|png|jpg|jpeg|gif|webp|bmp)$/i;
    cb(null, allowed.test(file.originalname) || file.mimetype.startsWith("text/"));
  },
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
router.post("/chat", chatLimiter, handleUpload, asyncHandler(chatController.chat));
router.post("/generate-title", chatLimiter, asyncHandler(chatController.generateTitle));
router.post("/follow-ups", chatLimiter, asyncHandler(chatController.followUps));
router.post("/search", chatLimiter, asyncHandler(searchController.performSearch));
router.post("/generate-image", chatLimiter, asyncHandler(imageController.generateImage));
router.post("/generate-video", chatLimiter, asyncHandler(videoController.generateVideo));
router.get("/video-status/:videoId", asyncHandler(videoController.checkVideoStatus));
router.post("/medical-answer", chatLimiter, asyncHandler(chatController.medicalAnswer));
router.post("/tts", chatLimiter, asyncHandler(chatController.textToSpeech));

module.exports = router;
