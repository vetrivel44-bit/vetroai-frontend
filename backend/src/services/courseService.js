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
const TRIES_PER_CHAPTER = 3;

// pipeStream reports progress through `res`; a chapter is collected silently.
const SILENT = { write() {}, locals: {} };

const COURSE_WRITER = `You are VetroAI, writing a complete course for beginners, to be read as a book (PDF). Write in Markdown only: no chat, no preamble, no "Sure!" or "In this chapter we will" filler.
Teach like the best patient teacher: explain every new idea in plain words with an everyday analogy before any code or jargon, define every term the first time it appears, and never assume knowledge the course hasn't taught yet.
Use real, correct, runnable examples (fenced code blocks with the language named) and show what they print or do. Prefer current, standard practice.`;

function outlinePrompt(topic) {
  return `Plan a complete beginner-to-confident course on: ${topic}

It must take a total beginner from absolute zero to building and finishing real things on their own, covering every topic a good paid course or book would, in a sensible order. Include: what it is and why it matters; setup; the fundamentals in small steps; the core features in depth; common tools and libraries; good practices, debugging and testing; real-world use; at least one guided project chapter that builds something complete; and finally a chapter "Cheat Sheet, Glossary and Next Steps".

Reply with ONLY this JSON, nothing before or after it:
{"title": "<course title>", "audience": "<one line: who it is for>", "chapters": [{"title": "<chapter title>", "topics": ["<topic>", "<topic>", "..."]}]}
Use ${MIN_CHAPTERS}-${MAX_CHAPTERS} chapters, each with 4-8 specific topics.`;
}

function chapterPrompt(course, index) {
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
- ### Practice: 3-5 exercises, easiest first.
- ### Solutions: worked solutions to every exercise.
- ### Recap: the key points as a short list.

Aim for 2,500-3,500 words. Finish the whole chapter, ending with the Recap.`;
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
async function write(provider, prompt, { maxTokens, modelLabel, signal, groqModel }) {
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
  let messages = [{ role: "system", content: COURSE_WRITER }, { role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
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

  send("status", "Planning the course…");
  let course = null;
  for (let i = 0; i < 2 && !course; i++) {
    const { text } = await writeWithFallback(state, outlinePrompt(topic), { maxTokens: 4000, modelLabel, signal });
    course = parseOutline(text);
  }
  if (!course) throw new Error("Couldn't plan the course. Please try again.");
  if (!course.title) course.title = topic;
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
        const { text } = await writeWithFallback(state, chapterPrompt(course, index), { maxTokens: CHAPTER_TOKENS, modelLabel, signal, groqModel: groqModelFor(index) });
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

module.exports = { buildCourse, parseOutline, outlinePrompt, chapterPrompt, groqModelFor, MIN_CHAPTERS, MAX_CHAPTERS };
