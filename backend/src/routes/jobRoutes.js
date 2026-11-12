const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { chatLimiter } = require("../middleware/rateLimiters");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { readResume, explainFit } = require("../services/resumeService");

// Job Search.
//   GET  /api/jobs/search?query=…   JSearch listings (the key stays on the server;
//                                    it used to be written into the browser code)
//   POST /api/jobs/resume { text }  → { profile }   the resume read into a profile
//   POST /api/jobs/fit { profile, job } → { fit }   advice on one job
const router = express.Router();

const JSEARCH_HOST = "jsearch.p.rapidapi.com";
// Only these go on to JSearch.
const PASS_THROUGH = ["query", "page", "num_pages", "radius", "date_posted", "employment_types", "job_requirements", "remote_jobs_only", "country", "language"];

router.get("/search", chatLimiter, asyncHandler(async (req, res) => {
  const key = config.jsearchApiKey || process.env.JSEARCH_API_KEY;
  if (!key) throw new ApiError(503, "Job search isn't set up on the server (JSEARCH_API_KEY is missing).");
  const params = new URLSearchParams();
  for (const name of PASS_THROUGH) {
    const value = req.query[name];
    if (value != null && value !== "") params.set(name, String(value).slice(0, 300));
  }
  if (!params.get("query")) throw new ApiError(400, "query is required");
  let upstream;
  try {
    upstream = await fetch(`https://${JSEARCH_HOST}/search-v2?${params}`, {
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": JSEARCH_HOST },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    logger.warn("jobs.search.unreachable", { error: err.message });
    throw new ApiError(502, "The job listings service could not be reached.");
  }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok || !body) {
    logger.warn("jobs.search.failed", { status: upstream.status });
    throw new ApiError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? "Job search is busy right now. Try again in a minute." : "Job listings could not be loaded.");
  }
  res.json(body);
}));

router.post("/resume", chatLimiter, asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "");
  if (text.trim().length < 80) throw new ApiError(400, "The resume has too little text to read.");
  res.json({ profile: await readResume(text) });
}));

router.post("/fit", chatLimiter, asyncHandler(async (req, res) => {
  const { profile, job } = req.body || {};
  if (!profile || !job?.title) throw new ApiError(400, "profile and job are required");
  res.json({ fit: await explainFit(profile, job) });
}));

module.exports = router;
