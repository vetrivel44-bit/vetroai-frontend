// Job Search through the backend (/api/jobs): listings (the JSearch key
// lives on the server, no longer in this code), reading a resume into a
// profile, and advice on how one job fits it.
import { resolveApiBase } from "./apiBase";
import { authHeaders } from "./usageClient";

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PRODUCTION_API_BASE);

async function call(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`${API}/jobs/${path}`, {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Job search failed (${res.status})`);
  return data;
}

/** JSearch search-v2 results for a query string ("query=…&radius=…"). */
export const searchJobs = (queryString, { signal } = {}) => call(`search?${queryString}`, { signal });

/** The resume's text → { profile } (profile is null when the AI couldn't read it). */
export const readResumeProfile = (text, { signal } = {}) => call("resume", { method: "POST", body: { text: String(text).slice(0, 16000) }, signal });

/** Advice on one job: { fit: { verdict, strengths, gaps, tips } | null }. */
export const explainJobFit = (profile, job, { signal } = {}) => call("fit", {
  method: "POST",
  body: {
    profile,
    job: { title: job.title, company: job.company, location: job.location, experienceLevel: job.experienceLevel, skills: job.skills, description: String(job.description || "").slice(0, 5000) },
  },
  signal,
});
