const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { findSiteImage } = require("../services/siteImageService");

// GET /api/site-image?q=red+running+shoes&w=800&h=600&i=2
// Redirects to a photo of the subject. Generated websites use it as an
// <img src>, so the pictures match the site (see AIOrchestrator's design
// prompt and the frontend's lib/siteImages.js).
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const url = await findSiteImage({ q: req.query.q, w: req.query.w, h: req.query.h, i: req.query.i });
  res.set("Cache-Control", "public, max-age=86400");
  res.redirect(302, url);
}));

module.exports = router;
