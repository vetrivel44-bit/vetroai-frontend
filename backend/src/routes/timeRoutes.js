const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { successResponse } = require("../utils/response");
const ApiError = require("../utils/apiError");
const { describeClock, timeZoneForPlace, validTimeZone } = require("../services/clockService");

// GET /api/time?place=London  → the current date and time there.
// GET /api/time?tz=Asia/Kolkata → the same for a known timezone.
// Used to answer "what time is it in …" exactly, instead of from web pages.
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const place = String(req.query.place || "").trim().slice(0, 80);
  const tz = validTimeZone(String(req.query.tz || ""));
  let zone = null;
  if (place) {
    zone = await timeZoneForPlace(place).catch(() => null);
    if (!zone) throw new ApiError(404, `Couldn't find a place called "${place}".`);
  } else if (tz) {
    zone = { timeZone: tz, name: tz };
  } else {
    throw new ApiError(400, "Give a place or a tz.");
  }
  const now = new Date();
  return successResponse(res, "Time found", { place: zone.name, ...describeClock({ timeZone: zone.timeZone, now }), iso: now.toISOString() });
}));

module.exports = router;
