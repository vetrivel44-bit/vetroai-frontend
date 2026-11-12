// Resume match for Job Search: reads a resume into a short profile, and
// explains how well one job fits it. The score itself is worked out in the
// browser (frontend utils/resumeMatch.js) so every card gets one instantly;
// the model here only reads the resume and writes the per-job advice.
const { defaultThinker } = require("./agenticSearchService");
const logger = require("../utils/logger");

const MAX_RESUME_CHARS = 16000;

const PROFILE_PROMPT = (text) => `Read this resume and return ONLY a JSON object, no prose, no code fence:
{"name": string|null, "headline": short current or target job title, "titles": up to 5 job titles this person fits (most likely first), "years": total years of work experience as a number (0 for a student or fresher), "level": "Internship"|"Entry Level"|"Mid-Level"|"Senior", "skills": up to 30 concrete skills, tools, technologies, certifications and licences (short names like "React", "Excel", "Tally", "Driving licence", "Patient care"), "education": highest degree and field or null, "locations": cities mentioned as where they live or want to work, "summary": one sentence on who they are}

RESUME:
${text}`;

const FIT_PROMPT = ({ profile, job }) => `You are a career coach. A candidate is looking at a job. In plain words, tell them how well they fit.
Return ONLY a JSON object, no prose, no code fence:
{"verdict": one short sentence (e.g. "Strong fit: you have the core stack"), "strengths": up to 3 short points where they match, "gaps": up to 3 short points they lack, "tips": up to 3 short, concrete things to do before applying (what to highlight on the resume, what to learn or mention)}
Base it only on the profile and the listing. Don't invent experience the candidate doesn't have.

CANDIDATE: ${JSON.stringify(profile).slice(0, 3000)}

JOB: ${job.title} at ${job.company} (${job.location || "location not given"}, ${job.experienceLevel || ""})
Skills listed: ${(job.skills || []).join(", ") || "none listed"}
Description: ${String(job.description || "").slice(0, 5000)}`;

/** The first {...} in a model reply, parsed; null when there is none. */
function parseJsonObject(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

const strList = (v, max) => (Array.isArray(v) ? v : [])
  .map((x) => String(x || "").trim()).filter((x) => x && x.length <= 80).slice(0, max);

function cleanProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const levels = ["Internship", "Entry Level", "Mid-Level", "Senior"];
  const years = Number(raw.years);
  const seen = new Set();
  const skills = strList(raw.skills, 40).filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).slice(0, 30);
  const titles = strList(raw.titles, 5);
  if (!skills.length && !titles.length) return null;
  return {
    name: raw.name ? String(raw.name).slice(0, 80) : null,
    headline: raw.headline ? String(raw.headline).slice(0, 100) : titles[0] || null,
    titles,
    years: Number.isFinite(years) && years >= 0 ? Math.min(Math.round(years * 10) / 10, 50) : null,
    level: levels.includes(raw.level) ? raw.level : null,
    skills,
    education: raw.education ? String(raw.education).slice(0, 140) : null,
    locations: strList(raw.locations, 4),
    summary: raw.summary ? String(raw.summary).slice(0, 300) : null,
  };
}

/**
 * The resume's text → a profile, or null when no model is configured or it
 * couldn't be read (the browser then falls back to its own skill scan).
 */
async function readResume(text, { think = defaultThinker() } = {}) {
  const body = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_RESUME_CHARS);
  if (body.length < 80) return null;
  if (!think) return null;
  try {
    return cleanProfile(parseJsonObject(await think(PROFILE_PROMPT(body), 900)));
  } catch (err) {
    logger.warn("resume.read.failed", { error: err.message });
    return null;
  }
}

/** Advice on one job for a profile, or null. */
async function explainFit(profile, job, { think = defaultThinker() } = {}) {
  if (!think || !profile || !job?.title) return null;
  try {
    const raw = parseJsonObject(await think(FIT_PROMPT({ profile, job }), 500));
    if (!raw) return null;
    return {
      verdict: raw.verdict ? String(raw.verdict).slice(0, 200) : null,
      strengths: strList(raw.strengths, 3),
      gaps: strList(raw.gaps, 3),
      tips: strList(raw.tips, 3),
    };
  } catch (err) {
    logger.warn("resume.fit.failed", { error: err.message });
    return null;
  }
}

module.exports = { readResume, explainFit, cleanProfile, parseJsonObject };
