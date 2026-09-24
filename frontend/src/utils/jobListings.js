// Job search — turning raw JSearch listings into what the panel shows, and
// deciding which of them are still open.
//
// The API happily returns postings whose application window has closed, and
// many listings carry no expiry at all. A listing is treated as closed when:
//   • its own expiry date has passed, or
//   • its text says it has stopped taking applications, or
//   • it has no expiry and was posted longer ago than MAX_OPEN_DAYS — past
//     that, an undated posting is almost always filled or abandoned.

export const MAX_OPEN_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

const CLOSED_PHRASES = /\b(no longer accepting applications|applications? (?:are |is )?(?:now )?closed|position (?:has been|is) filled|this (?:job|position|posting|internship) (?:has )?(?:expired|closed)|job (?:has )?expired|not accepting applications)\b/i;

const TYPE_LABELS = { FULLTIME: "Full-time", PARTTIME: "Part-time", CONTRACTOR: "Contract", INTERN: "Internship", TEMPORARY: "Temporary" };

export const POSTED_OPTIONS = [
  { id: "all", label: "Any time" },
  { id: "month", label: "Past month" },
  { id: "week", label: "Past week" },
  { id: "3days", label: "Past 3 days" },
  { id: "today", label: "Today" },
];

export function isInternshipQuery(query = "") {
  return /\b(intern|interns|internship|internships|trainee|apprentice(?:ship)?)\b/i.test(query);
}

function toTime(iso, seconds) {
  const t = Date.parse(iso || "");
  if (!Number.isNaN(t)) return t;
  if (typeof seconds === "number" && seconds > 0) return seconds * 1000;
  return null;
}

function typeLabel(raw, title) {
  const first = String(raw || "").split(/[,\s]+/).find(Boolean)?.toUpperCase();
  if (first && TYPE_LABELS[first]) return TYPE_LABELS[first];
  if (/\bintern(ship)?\b/i.test(title || "")) return "Internship";
  return raw ? String(raw) : "Full-time";
}

// Seniority from what the listing actually says, instead of a fixed guess.
export function experienceFor(j) {
  const title = j.job_title || "";
  const types = String(j.job_employment_type || "") + " " + (j.job_employment_types || []).join(" ");
  if (/\bINTERN\b/i.test(types) || /\b(intern|internship|trainee|apprentice)\b/i.test(title)) return "Internship";
  if (/\b(senior|sr\.?|lead|principal|staff|head|director|manager)\b/i.test(title)) return "Senior";
  if (/\b(junior|jr\.?|entry|fresher|graduate|associate)\b/i.test(title)) return "Entry Level";
  const exp = j.job_required_experience || {};
  if (exp.no_experience_required) return "Entry Level";
  const months = exp.required_experience_in_months;
  if (typeof months === "number") {
    if (months < 12) return "Entry Level";
    if (months >= 60) return "Senior";
  }
  return "Mid-Level";
}

export function normalizeJob(j, i = 0) {
  const title = j.job_title || "Untitled role";
  return {
    id: j.job_id || String(i),
    title,
    company: j.employer_name || "Company",
    location: `${j.job_city || ""} ${j.job_state || ""} ${j.job_country || ""}`.trim() || j.job_location || "Unknown",
    description: j.job_description || "",
    remote: !!j.job_is_remote,
    type: typeLabel(j.job_employment_type, title),
    experienceLevel: experienceFor(j),
    salary: j.job_min_salary ? { min: j.job_min_salary, max: j.job_max_salary || j.job_min_salary, currency: j.job_salary_currency || "$" } : null,
    // No date means we don't know it — not "posted just now".
    postedAt: (() => { const t = toTime(j.job_posted_at_datetime_utc, j.job_posted_at_timestamp); return t ? new Date(t).toISOString() : null; })(),
    expiresAt: (() => { const t = toTime(j.job_offer_expiration_datetime_utc, j.job_offer_expiration_timestamp); return t ? new Date(t).toISOString() : null; })(),
    applyUrl: j.job_apply_link || `https://www.google.com/search?q=${encodeURIComponent(title + " " + (j.employer_name || ""))}`,
    skills: j.job_required_skills || [],
    color: "#8b7bff",
    tags: [],
    logo: j.employer_logo || null,
    industry: j.employer_company_type || null,
    website: j.employer_website || null,
    lat: typeof j.job_latitude === "number" ? j.job_latitude : null,
    lng: typeof j.job_longitude === "number" ? j.job_longitude : null,
  };
}

/** Why a listing is closed, or null while it is still open. */
export function closedReason(job, now = Date.now()) {
  const expires = Date.parse(job.expiresAt || "");
  if (!Number.isNaN(expires) && expires < now) return "expired";
  if (CLOSED_PHRASES.test(job.description || "")) return "closed";
  if (Number.isNaN(expires)) {
    const posted = Date.parse(job.postedAt || "");
    if (!Number.isNaN(posted) && now - posted > MAX_OPEN_DAYS * DAY_MS) return "stale";
  }
  return null;
}

export const isOpen = (job, now = Date.now()) => closedReason(job, now) === null;

/** "Closes today" / "Closes in 5 days" / "Apply by 12 Oct", or null. */
export function deadlineLabel(job, now = Date.now()) {
  const expires = Date.parse(job.expiresAt || "");
  if (Number.isNaN(expires) || expires < now) return null;
  const days = Math.floor((expires - now) / DAY_MS);
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  if (days <= 14) return `Closes in ${days} days`;
  return `Apply by ${new Date(expires).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * Query-string additions for the JSearch request: internships as their own
 * employment type, and a posting-date window so old listings aren't fetched
 * in the first place.
 */
export function searchParams({ internships = false, posted = "month" } = {}) {
  let params = "";
  if (internships) params += "&employment_types=INTERN";
  if (posted && posted !== "all") params += `&date_posted=${encodeURIComponent(posted)}`;
  return params;
}
