const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { findSiteImage, placeholderSvg } = require("../services/siteImageService");

// GET /api/site-image?q=red+running+shoes&w=800&h=600&i=2
// Redirects to a photo of the subject. Generated websites use it as an
// <img src>, so the pictures match the site (see AIOrchestrator's design
// prompt and the frontend's lib/siteImages.js). When no photo is found it
// answers with a labelled placeholder image, never a broken one.
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const { q, w, h, i } = req.query;
  const url = await findSiteImage({ q, w, h, i });
  if (url) {
    res.set("Cache-Control", "public, max-age=86400");
    return res.redirect(302, url);
  }
  // Short cache: the photo sources may be back in a few minutes.
  res.set("Cache-Control", "public, max-age=300");
  res.type("image/svg+xml").send(placeholderSvg({ q, w, h }));
}));

module.exports = router;
