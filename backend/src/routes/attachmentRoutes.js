const express = require("express");
const controller = require("../controllers/attachmentController");
const authMiddleware = require("../middleware/authMiddleware");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authMiddleware);

router.get("/", asyncHandler(controller.listAttachments));
router.delete("/:id", asyncHandler(controller.deleteAttachment));

module.exports = router;
