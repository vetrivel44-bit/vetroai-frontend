const express = require("express");
const controller = require("../controllers/bookingController");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/", asyncHandler(controller.bookSession));

module.exports = router;
