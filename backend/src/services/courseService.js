// A complete course on a topic ("teach me Node.js from start to end"), long
// enough to really cover it: no single reply can hold 100+ pages, so the
// course is planned first (an outline of chapters), then each chapter is
// written on its own, a few at a time, and handed back as it is finished.
// The app turns the chapters into a PDF and a Word file (CourseCard).
//
// Each chapter is a plain, short request of its own (COURSE_WRITER, not the
// ~10k-token chat prompt), so every model fits it — Groq included.

const logger = require("../utils/logger");
const providerManager = require("./ProviderManager");
const orchestrator = require("./AIOrchestrator");
const { withTimeout } = require("../utils/withTimeout");
const { modelFor: sarvamModelFor } = require("../providers/sarvamAdapter");
const { config } = require("../config/env");
const { searchWeb } = require("../controllers/searchController");

const MIN_CHAPTERS = 20;
const MAX_CHAPTERS = 30;
const CHAPTER_TOKENS = 7000;
// Each Groq model takes ~8k tokens a minute, prompt included, so a Groq
// chapter is a shorter turn (continued if it runs out).
const GROQ_CHAPTER_TOKENS = 5000;

/**
 * The Groq model for chapter `index`: chapters alternate between the course
 * models (config.groqCourseModels), and each model has its own per-minute
 * limit, so two of them write a course about twice as fast as one.
 */
function groqModelFor(index) {
  const models = config.groqCourseModels || [];
  return models.length ? models[index % models.length] : undefined;
}
const MAX_CONTINUATIONS = 2;
// The editor returns corrections only, not the chapter.
const EDITOR_TOKENS = 2500;
const TRIES_PER_CHAPTER = 3;

// pipeStream reports progress through `res`; a chapter is collected silently.
const SILENT = { write() {}, locals: {} };

// A reader's review of the first Node.js course found broken code (a template
// literal without its backticks), code fences printed as text, exercises
// numbered on from earlier chapters, garbled sentences, Heroku advice given
// for Render, no warning that a free host's disk is wiped, a muddled event
// loop, and Node 20 (end of life) as "the" version. The rules below, the
// web-searched CURRENT FACTS and the editor pass (EDITOR) answer those.
const COURSE_WRITER = `You are VetroAI, writing a complete course for beginners, to be read as a book (PDF). Write in Markdown only: no chat, no preamble, no "Sure!" or "In this chapter we will" filler.
Teach like the best patient teacher: explain every new idea in plain words with an everyday analogy before any code or jargon, define every term the first time it appears, and never assume knowledge the course hasn't taught yet.

Accuracy comes first:
- Explain how things really work, precisely, with the standard names. Never invent a term or simplify a concept into something false.
- Use current, standard practice. Prefer what the language or tool now has built in, and mention the popular package that does the same job when readers will meet it.
- Never present a specific version number as current unless CURRENT FACTS give it; otherwise say "the current LTS/stable version" and where to get it.
- Instructions for a platform or tool must be that platform's own way of doing it (don't carry one host's conventions over to another).
- Warn the reader wherever they could lose data, money or security: free hosts whose disks are wiped on redeploy, secrets in code, costs.
- Every sentence must say one clear, correct thing. Re-read it.

Code:
- Every code sample is complete, correct and runnable as shown, inside a fenced block that names its language, with what it prints or does.
- Fences always start at the beginning of their own line, never at the end of a sentence and never indented under a list item: write the exercise text, then the code block below it.
- Keep every character the language needs (for example a JavaScript template literal keeps both backticks).`;

/** The subject alone: "teach me node js from start to end" -> "node js". */
function subjectOf(topic) {
  return String(topic || "")
    .replace(/\b(please|can you|could you|i want to|i'd like to|help me)\b/gi, " ")
    .replace(/\b(teach|learn|explain|give|make|create|write)\s+(me\s+)?(about\s+)?/gi, " ")
    .replace(/\b(like\s+)?from\s+(the\s+)?(start(ing)?|scratch|beginning|basics?|zero)\s*((to|till|until|up ?to)\s+(the\s+)?\w+)?/gi, " ")
    .replace(/\b(complete|full|entire|whole|a\s*to\s*z|zero to hero|in[- ]depth|comprehensive|step[- ]by[- ]step)\b/gi, " ")
    .replace(/\b(course|tutorial|guide|book|ebook|notes|pdf|lessons?)\b/gi, " ")
    // "beginners", and its common misspellings ("begginers").
    .replace(/\bfor\s+(absolute\s+|complete\s+)?beg+in+ers?\b|\bas\s+an?\b|\bin\s+an?\b/gi, " ")
    .replace(/[^\p{L}\p{N}+#.\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(on|about|of|to)\s+/i, "") || String(topic || "").trim();
}

const factsBlock = (facts) => (facts
  ? `\n\nCURRENT FACTS (from a web search today; prefer these over anything you remember):\n${facts}`
  : "");

function outlinePrompt(topic, facts = "") {
  return `Plan a complete beginner-to-confident course on: ${topic}${factsBlock(facts)}

It must take a total beginner from absolute zero to building and finishing real things on their own, covering every topic a good paid course or book would, in a sensible order. Include: what it is and why it matters; setup; the fundamentals in small steps; the core features in depth; common tools and libraries; good practices, debugging and testing; real-world use; at least one guided project chapter that builds something complete; and finally a chapter "Cheat Sheet, Glossary and Next Steps".

Reply with ONLY this JSON, nothing before or after it:
{"title": "<course title>", "audience": "<one line: who it is for>", "chapters": [{"title": "<chapter title>", "topics": ["<topic>", "<topic>", "..."]}]}
Use ${MIN_CHAPTERS}-${MAX_CHAPTERS} chapters, each with 4-8 specific topics.`;
}

function chapterPrompt(course, index, facts = course.facts || "") {
  const chapter = course.chapters[index];
  const before = course.chapters.slice(0, index).map((c, i) => `${i + 1}. ${c.title}`).join("\n") || "(none: this is the first chapter)";
  const after = course.chapters.slice(index + 1, index + 4).map((c, i) => `${index + i + 2}. ${c.title}`).join("\n") || "(none: this is the last chapter)";
  return `Course: ${course.title}
Audience: ${course.audience || "complete beginners"}

Already taught (build on these, don't repeat them):
${before}

Coming next (leave these for later):
${after}

Write Chapter ${index + 1}: ${chapter.title}
Cover all of these, each in depth: ${chapter.topics.join("; ")}.

Structure:
## Chapter ${index + 1}: ${chapter.title}
- A short opening: what the reader will be able to do after this chapter, and why it matters.
- One ### section per topic: explanation in plain words, an analogy where it helps, then worked examples with code and their output, then the gotchas beginners hit.
- ### Common Mistakes: the usual errors, what causes each, and the fix.
- ### Practice: 3-5 exercises, easiest first, numbered 1, 2, 3… (this chapter's own numbering, starting at 1).
- ### Solutions: a worked solution for every exercise, under the same numbers.
- ### Recap: the key points as a short list.

Aim for 2,500-3,500 words. Finish the whole chapter, ending with the Recap.${factsBlock(facts)}`;
}

// ── Editor pass ──────────────────────────────────────────────────────────
// A second reading of every chapter by a strict technical editor, who returns
// exact corrections rather than the whole chapter again: a few hundred tokens
// instead of thousands, and nothing the writer got right is rewritten.

const EDITOR = `You are a strict technical editor checking one chapter of a beginner's course before it is printed. Find real problems only:
- factual errors, wrong explanations and outdated advice (old versions as current, tools or steps that no longer apply, another platform's conventions);
- code that would not run or gives a different result than stated, including missing characters (such as a JavaScript template literal's backticks);
- a missing warning a beginner needs (data loss on free hosts, secrets, security, cost);
- sentences that contradict themselves or don't make sense;
- exercises or solutions not numbered 1, 2, 3… within the chapter.
Reply with ONLY this JSON: {"fixes": [{"find": "<exact text from the chapter, long enough to be unique>", "replace": "<the corrected text>"}]}
"find" must be copied exactly, character for character. To add a warning, find the sentence it belongs after and replace it with that sentence plus the warning. At most 15 fixes. If nothing needs fixing, reply {"fixes": []}.`;

function editorPrompt(course, chapterText, facts = course.facts || "") {
  return `Course: ${course.title}${factsBlock(facts)}\n\n--- CHAPTER ---\n${chapterText}`;
}

/** The editor's fixes from its reply, or [] if it can't be read. */
function parseFixes(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const data = JSON.parse(raw.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
    return (Array.isArray(data?.fixes) ? data.fixes : [])
      .filter((f) => f && typeof f.find === "string" && typeof f.replace === "string" && f.find !== f.replace)
      .slice(0, 15);
  } catch {
    return [];
  }
}

/**
 * The chapter with the editor's fixes applied. A fix whose text isn't found
 * exactly once, or that is too short to place safely, is skipped: a wrong
 * edit is worse than none.
 */
function applyFixes(chapterText, fixes) {
  let text = chapterText;
  let applied = 0;
  for (const { find, replace } of fixes) {
    if (find.trim().length < 12) continue;
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) continue;
    text = text.slice(0, at) + replace + text.slice(at + find.length);
    applied++;
  }
  return { text, applied };
}

// The outline as JSON, read leniently (a sentence around it, trailing commas).
function parseOutline(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  const chapters = (Array.isArray(data?.chapters) ? data.chapters : [])
    .map((c) => ({
      title: String(typeof c === "string" ? c : c?.title || "").trim().slice(0, 140),
      topics: (Array.isArray(c?.topics) ? c.topics : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10),
    }))
    .filter((c) => c.title)
    .slice(0, MAX_CHAPTERS);
  if (chapters.length < 5) return null;
  for (const c of chapters) if (!c.topics.length) c.topics = [c.title];
  return { title: String(data.title || "").trim().slice(0, 160), audience: String(data.audience || "").trim().slice(0, 200), chapters };
}

/** One model turn, collected; continues once or twice if it ran out of tokens. */
async function write(provider, prompt, { maxTokens, modelLabel, signal, groqModel, system = COURSE_WRITER, continues = MAX_CONTINUATIONS }) {
  const adapter = providerManager.getAdapter(provider);
  if (!adapter) throw new Error(`No adapter for ${provider}`);
  const options = {
    maxTokens,
    model: provider === "groq" ? groqModel : undefined,
    temperature: 0.5,
    // No separate reasoning pass: the whole budget goes to the chapter.
    light: true,
    effort: "balanced",
    sarvamModel: provider === "sarvam" ? sarvamModelFor(modelLabel) || undefined : undefined,
  };
  let messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn <= continues; turn++) {
    if (signal?.aborted) throw new Error("cancelled");
    const stream = await withTimeout(adapter.generateStream(messages, options), adapter.startTimeoutMs?.() || 45000, "Stream generation timeout");
    const info = {};
    const part = await orchestrator.pipeStream(stream, SILENT, provider, info);
    text += part || "";
    if (!orchestrator.wasCutOff(text, info.finishReason) || !(part || "").trim()) break;
    messages = [...messages.slice(0, 2), { role: "assistant", content: text }, { role: "user", content: "Continue exactly where you stopped, without repeating anything." }];
  }
  if (!text.trim()) throw new Error("Provider returned an empty response");
  return text;
}

/** `write` on the picked model, falling back to others when it fails. */
async function writeWithFallback(state, prompt, opts) {
  const tried = [];
  let provider = state.provider;
  let lastError = null;
  for (let attempt = 0; attempt < TRIES_PER_CHAPTER && provider; attempt++) {
    tried.push(provider);
    const started = Date.now();
    try {
      const maxTokens = provider === "groq" ? Math.min(opts.maxTokens, GROQ_CHAPTER_TOKENS) : opts.maxTokens;
      const text = await write(provider, prompt, { ...opts, maxTokens });
      providerManager.updateMetrics(provider, true, Date.now() - started);
      return { text, provider };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err;
      providerManager.updateMetrics(provider, false, Date.now() - started);
      logger.warn("course.writeFailed", { provider, error: err.message });
      // A picked model that keeps failing hands the rest of the course over.
      provider = providerManager.getFallbackProvider(provider, tried);
      if (provider && attempt === TRIES_PER_CHAPTER - 2) state.provider = provider;
    }
  }
  throw lastError || new Error("No model is available");
}

/**
 * A few lines of current facts about the subject from a web search: its
 * current version and today's standard tools. Empty when search is down —
 * the course is still written, just from the model's own knowledge.
 */
async function currentFacts(topic, signal) {
  const subject = subjectOf(topic);
  try {
    const res = await withTimeout(searchWeb(`${subject} current stable or LTS version and current best practices ${new Date().getFullYear()}`), 12000, "Search timeout");
    if (signal?.aborted) return "";
    return String(res?.context || "").slice(0, 3500);
  } catch (err) {
    logger.warn("course.factsFailed", { error: err.message });
    return "";
  }
}

/**
 * The chapter after the editor's pass: its exact corrections applied. If the
 * editor fails or its reply can't be read, the chapter stands as written.
 */
async function editChapter(state, course, text, { modelLabel, signal, groqModel }) {
  try {
    // Another Groq model than the one that wrote it, where there is one: a
    // second opinion, and the other model's per-minute allowance.
    const review = await writeWithFallback(state, editorPrompt(course, text), {
      maxTokens: EDITOR_TOKENS, modelLabel, signal, groqModel, system: EDITOR, continues: 0,
    });
    const { text: fixed, applied } = applyFixes(text, parseFixes(review.text));
    logger.info("course.edited", { applied });
    return fixed;
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.warn("course.editFailed", { error: err.message });
    return text;
  }
}

/**
 * Builds the course, reporting through `send(type, data)`:
 *   status   one-line progress
 *   outline  { title, audience, chapters: [{ title, topics }] }
 *   chapter  { n, title, markdown }
 *   chapter_failed { n, title }
 *   done     { title, written, failed }
 * Returns the number of chapters written.
 */
async function buildCourse(topic, { preferredProvider, modelLabel, send, signal }) {
  const state = { provider: providerManager.getBestProvider("normal", preferredProvider) };
  if (!state.provider) throw new Error("No AI model is available right now.");

  // Current facts first (versions, today's standard tools), so neither the
  // plan nor any chapter teaches from the model's older memory.
  send("status", "Checking what's current…");
  const facts = await currentFacts(topic, signal);

  send("status", "Planning the course…");
  let course = null;
  for (let i = 0; i < 2 && !course; i++) {
    const { text } = await writeWithFallback(state, outlinePrompt(topic, facts), { maxTokens: 4000, modelLabel, signal });
    course = parseOutline(text);
  }
  if (!course) throw new Error("Couldn't plan the course. Please try again.");
  if (!course.title) course.title = topic;
  course.facts = facts;
  send("outline", course);

  // A few chapters at a time; on Groq one per course model, since each
  // model's per-minute limit only fits about one chapter at a time.
  const parallel = state.provider === "groq" ? Math.max(1, (config.groqCourseModels || []).length) : 3;
  let next = 0;
  let written = 0;
  let failed = 0;
  const worker = async () => {
    while (next < course.chapters.length) {
      if (signal?.aborted) return;
      const index = next++;
      const { title } = course.chapters[index];
      send("status", `Writing chapter ${index + 1} of ${course.chapters.length}: ${title}`);
      try {
        const draft = await writeWithFallback(state, chapterPrompt(course, index), { maxTokens: CHAPTER_TOKENS, modelLabel, signal, groqModel: groqModelFor(index) });
        send("status", `Checking chapter ${index + 1} of ${course.chapters.length}: ${title}`);
        const text = await editChapter(state, course, draft.text, { modelLabel, signal, groqModel: groqModelFor(index + 1) });
        written++;
        send("chapter", { n: index + 1, title, markdown: text.trim() });
      } catch (err) {
        if (signal?.aborted) return;
        failed++;
        logger.warn("course.chapterFailed", { chapter: index + 1, error: err.message });
        send("chapter_failed", { n: index + 1, title });
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  send("done", { title: course.title, written, failed });
  return written;
}

module.exports = { buildCourse, parseOutline, outlinePrompt, chapterPrompt, groqModelFor, subjectOf, parseFixes, applyFixes, COURSE_WRITER, EDITOR, MIN_CHAPTERS, MAX_CHAPTERS };
