const express = require("express");
const controller = require("../controllers/memoryController");
const authMiddleware = require("../middleware/authMiddleware");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authMiddleware);

router.get("/", asyncHandler(controller.listMemories));
router.post("/", asyncHandler(controller.addMemory));
router.delete("/", asyncHandler(controller.clearMemories));
router.delete("/:id", asyncHandler(controller.deleteMemory));

module.exports = router;
