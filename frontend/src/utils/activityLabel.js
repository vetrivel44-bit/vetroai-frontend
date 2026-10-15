// Turns what a turn is actually doing into the short status line shown while
// the reply is on its way — "Reading report.pdf…", "Searching the web for
// IPL scores…", "Checking the edge cases" — instead of a bare "Thinking…".

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i;
const CODE_RE = /```|\b(function|const|let|class|def|import|return|error|exception|stack ?trace|bug|debug|compile|syntax|regex|sql|api|typescript|javascript|python|java|react|css|html)\b/i;
const MATH_RE = /\b(solve|calculate|compute|integral|derivative|equation|probability|percent|sum of|prove)\b|\d+\s*[-+*/^×÷]\s*\d+/i;
const WRITE_RE = /\b(write|draft|compose|essay|poem|story|email|letter|cover letter|blog|caption|rewrite|rephrase|paraphrase)\b/i;
const SUMMARY_RE = /\b(summari[sz]e|summary|tl;?dr|key points|condense)\b/i;
const TRANSLATE_RE = /\btranslat(e|ion)\b/i;
const COMPARE_RE = /\b(compare|comparison|vs\.?|versus|difference between|better than|pros and cons)\b/i;
const PLAN_RE = /\b(plan|itinerary|schedule|roadmap|steps to|how (do|can|should) i)\b/i;
const EXPLAIN_RE = /^(what|why|how|explain|describe|define|tell me about)\b/i;

const clip = (text, max) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[,.;:!?-]+$/, "")}…`;
};

// The search the user is waiting on, trimmed to its subject: "what is the
// latest news on the ISRO launch?" → "the ISRO launch".
const searchSubject = (query) => {
  const stripped = String(query || "")
    .replace(/^(hey|hi|hello|please|can you|could you|pls)[,\s]+/i, "")
    .replace(/^(search( the web)?( for)?|look up|find( me)?|google|what('s| is| are)( the)?( latest| current)?( news| updates?)?( on| about| for)?|tell me( about)?|show me)\s+/i, "")
    .replace(/[?.!]+$/, "");
  return clip(stripped, 42);
};

const fileName = (file) => (file && typeof file.name === "string" ? file.name : "");

/**
 * What this request is about to do, as a status line.
 * `files` are the File/Blob attachments, `webSearch` whether a search runs.
 */
export function describeRequest({ query = "", files = [], mode = "", webSearch = false } = {}) {
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
  const images = list.filter((f) => IMAGE_RE.test(fileName(f)) || String(f.type || "").startsWith("image/"));
  const docs = list.filter((f) => !images.includes(f));
  const q = String(query || "").trim();

  if (docs.length === 1 && fileName(docs[0])) return `Reading ${clip(fileName(docs[0]), 36)}…`;
  if (docs.length > 1) return `Reading ${docs.length} files…`;
  if (images.length === 1) return "Looking at your image…";
  if (images.length > 1) return `Looking at ${images.length} images…`;

  switch (mode) {
    case "deep_search":
    case "research": return q ? `Researching ${searchSubject(q)}…` : "Researching…";
    case "debugger": return "Reading your code…";
    case "summarize": return "Condensing…";
    case "analyst": return "Crunching the numbers…";
    case "multi_ai": return "Consulting several models…";
    default: break;
  }

  if (webSearch && q) return `Searching the web for ${searchSubject(q)}…`;
  if (!q) return "Thinking…";
  if (SUMMARY_RE.test(q)) return "Pulling out the key points…";
  if (TRANSLATE_RE.test(q)) return "Translating…";
  if (CODE_RE.test(q)) return "Working through the code…";
  if (MATH_RE.test(q)) return "Working through the math…";
  if (COMPARE_RE.test(q)) return "Weighing the options…";
  if (WRITE_RE.test(q)) return "Drafting…";
  if (PLAN_RE.test(q)) return "Putting a plan together…";
  if (EXPLAIN_RE.test(q)) return "Working out an explanation…";
  return "Thinking…";
}

// Backend statuses that say nothing the user can use ("Consulting groq...")
// — the request description is more specific, so it wins over these.
const GENERIC_STATUS_RE = /^(preparing|streaming|idle|analy[sz]ing your request|consulting [\w.-]+|thinking)\W*$/i;

export const isGenericStatus = (status) => !status || GENERIC_STATUS_RE.test(String(status).trim());

const gerund = (verb) => {
  const v = verb.toLowerCase();
  if (v.endsWith("ing")) return v;
  if (v === "be") return "being";
  if (/ie$/.test(v)) return `${v.slice(0, -2)}ying`;
  if (/[^aeiou]e$/.test(v)) return `${v.slice(0, -1)}ing`;
  // Short consonant-vowel-consonant verbs double up: plan → planning.
  if (/^[^aeiou]+[aeiou][bdgmnprt]$/.test(v) && v.length <= 4) return `${v}${v.slice(-1)}ing`;
  return `${v}ing`;
};

/**
 * A one-line summary of what the model is reasoning about right now, taken
 * from the tail of its streamed reasoning: the latest **heading** the model
 * wrote if it uses them, else the start of its latest sentence.
 */
export function summarizeReasoning(reasoning = "") {
  const text = String(reasoning || "");
  if (!text.trim()) return "";

  const headings = [...text.matchAll(/(?:^|\n)\s*(?:#{1,4}\s+|\*\*)([^*\n]{3,80}?)(?:\*\*)?\s*(?=\n|$)/g)];
  if (headings.length) return clip(headings[headings.length - 1][1].replace(/[:.]+$/, ""), 60);

  // The sentence being written if it has got far enough to say something,
  // else the latest finished one with a few words in it.
  const flat = text.replace(/\s+/g, " ").trim();
  const words = (t) => t.split(" ").filter(Boolean).length;
  const tail = flat.split(/[.!?]+\s/).pop();
  const sentences = (flat.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).map((t) => t.trim()).filter((t) => words(t) >= 3);
  let latest = (words(tail) >= 4 ? tail : sentences[sentences.length - 1] || tail).trim()
    .replace(/^(okay|ok|alright|so|now|hmm|well|first|next|then|also|wait)[,\s]+/i, "")
    .replace(/[.!?]+$/, "");
  // "Let me check the dates" → "Checking the dates".
  const intent = latest.match(/^(?:let me|let's|i (?:need to|have to|want to|should|will|must)|i'll|i'm going to|i am going to)\s+([a-z]+)(.*)$/i);
  if (intent) latest = gerund(intent[1]) + intent[2];
  if (!latest) return "";
  return clip(latest.charAt(0).toUpperCase() + latest.slice(1), 60);
}
