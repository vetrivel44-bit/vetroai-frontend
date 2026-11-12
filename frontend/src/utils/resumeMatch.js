// Resume match for Job Search: how well each listing fits the user's resume,
// worked out here so every card gets a score at once (the backend only reads
// the resume into a profile, and writes per-job advice on request).
//
// profile: { headline, titles[], years, level, skills[], education, locations[], summary }

// Skills and tools the matcher recognises in listings and resumes. A listing
// rarely fills job_required_skills, so its description is scanned for these.
const SKILLS = [
  // Software
  "JavaScript", "TypeScript", "React", "Angular", "Vue.js", "Next.js", "Node.js", "Express", "HTML", "CSS", "Tailwind", "Redux",
  "Python", "Django", "Flask", "FastAPI", "Java", "Spring Boot", "Kotlin", "Swift", "Flutter", "Dart", "React Native", "Android", "iOS",
  "C", "C++", "C#", ".NET", "Go", "Rust", "PHP", "Laravel", "Ruby", "Rails", "Scala",
  "SQL", "MySQL", "PostgreSQL", "MongoDB", "Redis", "Oracle", "Firebase", "GraphQL", "REST API", "Microservices",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Jenkins", "CI/CD", "Linux", "Git", "DevOps",
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "TensorFlow", "PyTorch", "Scikit-learn", "Pandas", "NumPy",
  "LLM", "Generative AI", "LangChain", "Data Analysis", "Data Science", "Statistics", "Power BI", "Tableau", "Spark", "Hadoop", "Airflow", "Kafka", "ETL",
  "Selenium", "Testing", "Automation Testing", "Cybersecurity", "Networking", "SAP", "Salesforce", "Agile", "Scrum", "Jira",
  // Design and marketing
  "Figma", "Adobe XD", "Photoshop", "Illustrator", "UI Design", "UX Design", "Wireframing", "Prototyping", "Canva", "Video Editing",
  "SEO", "Digital Marketing", "Social Media", "Content Writing", "Copywriting", "Google Ads", "Google Analytics", "Email Marketing",
  // Business, finance, operations
  "Excel", "Tally", "GST", "Accounting", "Bookkeeping", "Taxation", "Financial Analysis", "Auditing", "Payroll", "Budgeting",
  "Sales", "Business Development", "Lead Generation", "CRM", "Customer Service", "Negotiation", "Communication", "Leadership", "Team Management",
  "Project Management", "Recruitment", "HR", "Operations", "Supply Chain", "Logistics", "Inventory", "Procurement", "Product Management",
  // Engineering and trades
  "AutoCAD", "SolidWorks", "CATIA", "ANSYS", "Revit", "STAAD Pro", "MATLAB", "PLC", "SCADA", "Embedded C", "PCB Design", "VLSI",
  "Electrical", "Welding", "Plumbing", "Driving Licence", "Forklift", "Quality Control", "Six Sigma", "Lean", "Safety",
  // Health and education
  "Patient Care", "Nursing", "Pharmacy", "Phlebotomy", "First Aid", "CPR", "Medical Coding", "Physiotherapy",
  "Teaching", "Lesson Planning", "Tutoring", "Curriculum Design",
  // Languages
  "English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam",
];

// Other ways a skill is written, all lower case.
const ALIASES = {
  javascript: ["js", "es6", "ecmascript"], typescript: ["ts"], react: ["react.js", "reactjs"], "vue.js": ["vue", "vuejs"],
  "next.js": ["nextjs"], "node.js": ["node", "nodejs"], express: ["express.js", "expressjs"], "spring boot": ["springboot", "spring"],
  "c#": ["csharp"], ".net": ["dotnet", "asp.net"], go: ["golang"], postgresql: ["postgres"], mongodb: ["mongo"],
  "rest api": ["rest", "restful", "rest apis", "restful apis"], gcp: ["google cloud"], kubernetes: ["k8s"], "ci/cd": ["cicd"],
  "machine learning": ["ml"], "deep learning": ["dl"], nlp: ["natural language processing"], "scikit-learn": ["sklearn", "scikit learn"],
  llm: ["llms", "large language models"], "generative ai": ["genai", "gen ai"], "power bi": ["powerbi"], "ui design": ["ui"], "ux design": ["ux", "user experience"],
  excel: ["ms excel", "microsoft excel", "advanced excel"], tally: ["tally erp", "tally prime"], seo: ["search engine optimization"],
  "social media": ["social media marketing", "smm"], hr: ["human resources"], crm: ["crm software"], "driving licence": ["driving license", "driver's license", "two wheeler", "two-wheeler"],
  "customer service": ["customer support"], "project management": ["pmp"], "patient care": ["patient handling"], nursing: ["gnm", "anm", "b.sc nursing"],
  "embedded c": ["embedded"], "quality control": ["qc", "quality assurance", "qa"], testing: ["manual testing", "software testing"],
};

const lower = (s) => String(s || "").toLowerCase();
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A skill as a whole word: "Go" must not match "good", "C" not "CSS".
const wordRx = (term) => new RegExp(`(?<![a-z0-9+#.])${escapeRx(term)}(?![a-z0-9+#])`, "i");

const CANON = new Map(); // any spelling → the canonical name
for (const skill of SKILLS) CANON.set(lower(skill), skill);
for (const [name, list] of Object.entries(ALIASES)) {
  const canonical = CANON.get(name) || name;
  for (const alias of list) CANON.set(alias, canonical);
}
const SPELLINGS = [...CANON.entries()].map(([spelling, canonical]) => ({ canonical, rx: wordRx(spelling) }));
// Terms too common in ordinary prose to count when found in a description.
const PROSE_WORDS = new Set(["C", "Go", "Sales", "Communication", "Leadership", "Testing", "Safety", "Electrical", "Operations", "HR", "English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Lean", "Inventory", "Teaching"]);

/** A skill's canonical name ("reactjs" → "React"), or the skill as written. */
export function canonicalSkill(skill) {
  const s = String(skill || "").trim();
  return CANON.get(lower(s)) || s;
}

/** Every known skill mentioned in a text, by canonical name. */
export function skillsInText(text, { strict = false } = {}) {
  const found = new Set();
  const t = String(text || "");
  for (const { canonical, rx } of SPELLINGS) {
    if (strict && PROSE_WORDS.has(canonical)) continue;
    if (!found.has(canonical) && rx.test(t)) found.add(canonical);
  }
  return [...found];
}

const LEVEL_RANK = { Internship: 0, "Entry Level": 1, "Mid-Level": 2, Senior: 3 };
const levelFromYears = (years) => (years == null ? null : years < 1 ? "Entry Level" : years < 5 ? "Mid-Level" : "Senior");

/** A profile from a resume's text alone, for when the AI reader isn't available. */
export function profileFromText(text) {
  const t = String(text || "");
  const years = (() => {
    const m = t.match(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years?|yrs?)\b(?:\s+of)?\s+(?:experience|exp)/i);
    return m ? Number(m[1]) : null;
  })();
  const skills = skillsInText(t);
  return { name: null, headline: null, titles: [], years, level: levelFromYears(years), skills, education: null, locations: [], summary: null, source: "scan" };
}

/** Merge the AI's profile with the skills a scan finds, canonical and de-duplicated. */
export function completeProfile(profile, text = "") {
  const base = profile || profileFromText(text);
  const skills = new Map();
  for (const s of [...(base.skills || []), ...skillsInText(text)]) {
    const c = canonicalSkill(s);
    if (c && !skills.has(lower(c))) skills.set(lower(c), c);
  }
  return { ...base, skills: [...skills.values()].slice(0, 40), level: base.level || levelFromYears(base.years) };
}

const STOP = new Set(["and", "or", "the", "of", "for", "in", "at", "a", "an", "to", "with", "senior", "junior", "sr", "jr", "lead", "intern", "internship", "trainee", "associate", "i", "ii", "iii", "remote", "hybrid"]);
const titleWords = (s) => lower(s).split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w));

function titleFit(profile, job) {
  const jobWords = new Set(titleWords(job.title));
  if (!jobWords.size) return 0;
  let best = 0;
  for (const title of [profile.headline, ...(profile.titles || [])].filter(Boolean)) {
    const words = titleWords(title);
    if (!words.length) continue;
    const shared = words.filter((w) => jobWords.has(w)).length;
    best = Math.max(best, shared / Math.min(words.length, jobWords.size));
  }
  return Math.min(best, 1);
}

function levelFit(profile, job) {
  const want = LEVEL_RANK[job.experienceLevel];
  const have = LEVEL_RANK[profile.level || levelFromYears(profile.years)];
  if (want == null || have == null) return 0.7;
  if (job.experienceLevel === "Internship") return have <= 1 ? 1 : 0.5;
  const gap = want - have;
  if (gap <= 0) return gap < -1 ? 0.7 : 1; // over-qualified by two levels reads as a weaker fit
  return gap === 1 ? 0.5 : 0.15;
}

/**
 * How well a job fits a profile.
 * @returns {{ score: number, matched: string[], missing: string[], label: string, tone: "high"|"mid"|"low" }}
 */
export function matchJob(profile, job) {
  if (!profile || !job) return null;
  const mine = new Set((profile.skills || []).map((s) => lower(canonicalSkill(s))));
  const listed = (job.skills || []).map(canonicalSkill);
  const described = skillsInText(`${job.title} ${job.description || ""}`, { strict: true });
  // The listing's own skills come first; the description adds the rest.
  const wanted = [...new Map([...listed, ...described].map((s) => [lower(s), s])).values()];
  // A resume skill the description mentions in plain words still counts.
  const text = lower(`${job.title} ${job.description || ""} ${listed.join(" ")}`);
  const mentioned = (profile.skills || []).map(canonicalSkill).filter((s) => wordRx(lower(s)).test(text));
  const matched = [...new Map([...wanted.filter((s) => mine.has(lower(s))), ...mentioned].map((s) => [lower(s), s])).values()];
  const missing = wanted.filter((s) => !mine.has(lower(s))).slice(0, 6);

  const needed = Math.max(Math.min(wanted.length, 8), 3);
  const skillPart = Math.min(matched.length / needed, 1);
  const titlePart = titleFit(profile, job);
  const levelPart = levelFit(profile, job);
  // A listing with few recognisable skills leans more on the title.
  const skillWeight = wanted.length >= 3 ? 0.55 : 0.35;
  const raw = skillWeight * skillPart + (0.8 - skillWeight) * titlePart + 0.2 * levelPart;
  const score = Math.max(5, Math.min(98, Math.round(raw * 100)));
  const tone = score >= 70 ? "high" : score >= 45 ? "mid" : "low";
  const label = tone === "high" ? "Strong match" : tone === "mid" ? "Good match" : "Stretch";
  return { score, matched: matched.slice(0, 8), missing, label, tone };
}

/** Jobs best match first (ties keep their order). */
export function sortByMatch(jobs, profile) {
  if (!profile) return jobs;
  return jobs
    .map((job, i) => ({ job, i, s: matchJob(profile, job)?.score ?? 0 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.job);
}

/** What to search for this resume, when the box is empty. */
export function resumeQuery(profile) {
  return String(profile?.titles?.[0] || profile?.headline || profile?.skills?.slice(0, 2).join(" ") || "").trim();
}
