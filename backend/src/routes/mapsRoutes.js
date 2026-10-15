const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const mapsController = require("../controllers/mapsController");

const router = express.Router();

router.get("/search", asyncHandler(mapsController.searchPlaces));
router.get("/details", asyncHandler(mapsController.placeDetails));
router.get("/directions", asyncHandler(mapsController.getDirections));
router.get("/images", asyncHandler(mapsController.getMapImages));
router.get("/photo", asyncHandler(mapsController.placePhoto));

module.exports = router;
