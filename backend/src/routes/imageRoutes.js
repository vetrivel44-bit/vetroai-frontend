const express = require("express");
const multer = require("multer");
const asyncHandler = require("../middleware/asyncHandler");
const { generateImage } = require("../controllers/imageController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

router.post("/generate", upload.single("image"), asyncHandler(generateImage));

module.exports = router;
