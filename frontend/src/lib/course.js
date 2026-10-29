// "Teach me Node.js from start to end for beginners": instead of one chat
// reply (which tops out far short of a whole subject), the backend plans a
// full course and writes it chapter by chapter (/api/course); the chat shows
// its progress (CourseCard) and turns it into a PDF and a Word file.

const TEACH = /\b(teach|learn|course|tutorial|guide|lessons?|book|ebook|notes|master|study)\b/i;
// "from start to end", "from scratch", "complete", "zero to hero", "A to Z"…
const WHOLE = /\b(from\s+(the\s+)?(start(ing)?|scratch|beginning|basics?|zero|ground up)|(start(ing)?|beginning|basics?|zero|scratch)\s+(to|till|until|upto|up to)\s+(the\s+)?(end|ending|advanced?|expert|pro|hero|master(y|ing)?|finish)|complete|full|entire|whole|end[- ]to[- ]end|a\s*to\s*z|zero to hero|everything (about|in)|in[- ]depth|comprehensive|step[- ]by[- ]step)\b/i;
const AS_FILE = /\b(pdf|ebook|e-book|book|notes)\b/i;
const BEGINNER = /\bbegin+ers?\b|\bnewbies?\b|\bnoob\b/i;

/**
 * A request for a whole course rather than a quick answer: "teach me X"
 * with "from start to end" (or complete, zero to hero, A to Z…), or a
 * teach-me for beginners asked for as a PDF or book.
 */
export function isCourseRequest(text) {
  const t = String(text || "");
  if (t.length > 400 || !TEACH.test(t)) return false;
  return WHOLE.test(t) || (AS_FILE.test(t) && BEGINNER.test(t));
}

/** The subject, for the backend: the request as written, trimmed. */
export function courseTopic(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

/** The whole course as one Markdown book: cover, contents, chapters in order. */
export function courseMarkdown(course) {
  const chapters = (course.chapters || []).filter((c) => c.markdown);
  const contents = (course.chapters || []).map((c, i) => `${i + 1}. ${c.title}${c.markdown ? "" : " (not written)"}`).join("\n");
  const parts = [
    `# ${course.title || "Course"}`,
    course.audience ? `*${course.audience}*` : "",
    "*A complete course by VetroAI*",
    "## Contents",
    contents,
    ...chapters.map((c) => c.markdown.replace(/^#\s/gm, "## ")),
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Server-sent events from /api/course, one parsed `{ type, data }` at a time. */
export async function readCourseEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop();
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5))); } catch { /* a malformed frame is skipped */ }
    }
  }
}

/** The course state after one event (pure, so it is easy to test). */
export function applyCourseEvent(course, event) {
  const { type, data } = event || {};
  switch (type) {
    case "status":
      return { ...course, status: String(data || "") };
    case "outline":
      return {
        ...course,
        title: data.title || course.title,
        audience: data.audience || "",
        chapters: (data.chapters || []).map((c) => ({ title: c.title, state: "pending", markdown: "" })),
      };
    case "chapter":
    case "chapter_failed": {
      const chapters = (course.chapters || []).slice();
      const i = Number(data.n) - 1;
      if (i < 0) return course;
      chapters[i] = { title: data.title || chapters[i]?.title || `Chapter ${data.n}`, state: type === "chapter" ? "done" : "failed", markdown: type === "chapter" ? String(data.markdown || "") : "" };
      return { ...course, chapters };
    }
    case "done":
      return { ...course, phase: "done", status: "" };
    case "error":
      return { ...course, phase: "error", error: String(data || "The course couldn't be made."), status: "" };
    default:
      return course;
  }
}
