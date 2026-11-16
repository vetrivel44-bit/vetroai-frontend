const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { previewImageLimiter } = require("../middleware/rateLimiters");
const { findPhotos, aboutPerson } = require("../services/photoSearch");
const { tavilyImages } = require("../controllers/searchController");

// GET /api/photos?q=Kajal+Aggarwal&person=1
// Real photos of a subject: { images: [{ url, caption }], person, name }.
// The app uses it when asked to make a picture of a real person (it shows
// real photos of them instead) and for a reply's ```photos block. With
// person=1 it first checks the subject is a real person (Wikipedia), and
// looks for photos only if so.
const router = express.Router();

router.get("/", previewImageLimiter, asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!q) return res.status(400).json({ success: false, message: "q is required" });
  let person = null;
  let name = q;
  if (req.query.person) {
    const found = await aboutPerson(q).catch(() => null);
    person = Boolean(found?.person);
    name = found?.name || q;
    if (!person) return res.json({ success: true, data: { person: false, name, images: [] } });
  }
  const images = await findPhotos(name, { limit: 4, tavilyImages: (subject) => tavilyImages(subject, 4) });
  res.set("Cache-Control", "public, max-age=3600");
  return res.json({ success: true, data: { person, name, images } });
}));

module.exports = router;
