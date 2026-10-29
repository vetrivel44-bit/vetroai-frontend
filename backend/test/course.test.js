const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");
const { parseOutline } = require("../src/services/courseService");
const { tierFor } = require("../src/config/usageLimits");

const outline = (n) => ({
  title: "Node.js from Zero",
  audience: "Complete beginners",
  chapters: Array.from({ length: n }, (_, i) => ({ title: `Topic ${i + 1}`, topics: [`Idea ${i + 1}a`, `Idea ${i + 1}b`] })),
});

test("the outline is read even with chat around it and trailing commas", () => {
  const text = `Sure! Here it is:\n${JSON.stringify(outline(6)).replace(/]}$/, ",]}")}\nHope this helps.`;
  const course = parseOutline(text);
  assert.equal(course.title, "Node.js from Zero");
  assert.equal(course.chapters.length, 6);
  assert.deepEqual(course.chapters[0].topics, ["Idea 1a", "Idea 1b"]);
  assert.equal(parseOutline("no json here"), null);
  assert.equal(parseOutline(JSON.stringify(outline(2))), null, "too few chapters to be a course");
});

test("a whole course counts as one premium message", () => {
  assert.equal(tierFor("VetroAI Course").tier, "premium");
});

test("/api/course plans the course, then writes and sends every chapter", async (t) => {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const saved = config.sarvamApiKey;
  const realFetch = global.fetch;
  const bodies = [];
  config.sarvamApiKey = "test-key";
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith("http://127.0.0.1")) return realFetch(url, init);
    // The web search for current facts: down here, so the course goes on without them.
    if (!href.startsWith("https://api.sarvam.ai/")) throw new Error("offline");
    const body = JSON.parse(init.body);
    bodies.push(body);
    const ask = body.messages[body.messages.length - 1].content;
    const chapter = /Write Chapter (\d+): (.+)/.exec(ask);
    const editing = /--- CHAPTER ---/.test(ask);
    // The editor corrects chapter 2 and finds nothing wrong elsewhere.
    const content = editing
      ? JSON.stringify({ fixes: /Chapter 2:/.test(ask) ? [{ find: "Explained simply, using Node 20.", replace: "Explained simply, using the current LTS version." }] : [] })
      : chapter
      ? `## Chapter ${chapter[1]}: ${chapter[2]}\n\nExplained simply, using Node 20.\n\n### Recap\n- Done.`
      : JSON.stringify(outline(6));
    const frames = [{ choices: [{ delta: { content } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }];
    return new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  t.after(() => {
    global.fetch = realFetch;
    config.sarvamApiKey = saved;
    const s = providerManager.providers.sarvam;
    s.isSuspended = false;
    s.consecutiveErrors = 0;
  });

  const res = await realFetch(`${baseUrl}/api/course`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "teach me node js from start to end for beginners", provider: "Sarvam 105B", modelLabel: "Sarvam 105B" }),
  });
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  const of = (type) => events.filter((e) => e.type === type).map((e) => e.data);

  assert.equal(of("outline")[0].chapters.length, 6);
  const chapters = of("chapter").sort((a, b) => a.n - b.n);
  assert.deepEqual(chapters.map((c) => c.n), [1, 2, 3, 4, 5, 6]);
  assert.match(chapters[2].markdown, /^## Chapter 3: Topic 3/);
  assert.deepEqual(of("done")[0], { title: "Node.js from Zero", written: 6, failed: 0 });
  assert.equal(bodies.length, 13, "one outline, then each chapter written and checked");
  // The editor's correction is in the chapter the reader gets; others are as written.
  assert.match(chapters[1].markdown, /using the current LTS version\./);
  assert.match(chapters[0].markdown, /using Node 20\./);
  // Each request is its own short one, without the ~10k-token chat prompt,
  // and asks for no separate reasoning pass.
  for (const b of bodies) {
    assert.ok(b.messages[0].content.length < 4000);
    assert.equal(b.reasoning_effort, null);
  }
  // Later chapters are told what came before, so they don't repeat it.
  assert.match(bodies.find((b) => /Write Chapter 4:/.test(b.messages[1].content)).messages[1].content, /Already taught[\s\S]*3\. Topic 3/);
});

test("on Groq, chapters alternate between the two course models", () => {
  const { groqModelFor } = require("../src/services/courseService");
  assert.deepEqual([0, 1, 2, 3].map(groqModelFor), ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
});

test("the subject is pulled out of the request for the web search", () => {
  const { subjectOf } = require("../src/services/courseService");
  assert.equal(subjectOf("teach me node js like from starting to end for begginers"), "node js");
  assert.equal(subjectOf("Teach me Python from scratch"), "Python");
  assert.equal(subjectOf("complete course on React"), "React");
});

test("the editor's fixes are applied only where they fit exactly", () => {
  const { parseFixes, applyFixes } = require("../src/services/courseService");
  const chapter = "Deploy with a Procfile on Render.\n\nconsole.log(Total pay: ${pay});\nThe end. The end.";
  const fixes = parseFixes(`Here you go:\n${JSON.stringify({ fixes: [
    { find: "Deploy with a Procfile on Render.", replace: "On Render, set the start command in the dashboard." },
    { find: "console.log(Total pay: ${pay});", replace: "console.log(`Total pay: ${pay}`);" },
    { find: "The end.", replace: "Fin." }, // too short and not unique: skipped
    { find: "Text that isn't in the chapter at all.", replace: "x" }, // not found: skipped
  ] })}`);
  const { text, applied } = applyFixes(chapter, fixes);
  assert.equal(applied, 2);
  assert.match(text, /set the start command in the dashboard/);
  assert.match(text, /console\.log\(`Total pay: \$\{pay\}`\);/);
  assert.match(text, /The end\. The end\./);
  assert.deepEqual(parseFixes("no json"), []);
});

test("the writer is told the rules the first course broke", () => {
  const { COURSE_WRITER, EDITOR, chapterPrompt } = require("../src/services/courseService");
  assert.match(COURSE_WRITER, /never indented under a list item/);
  assert.match(COURSE_WRITER, /template literal keeps both backticks/);
  assert.match(COURSE_WRITER, /Never present a specific version number as current/);
  assert.match(COURSE_WRITER, /disks are wiped on redeploy/);
  assert.match(EDITOR, /another platform's conventions/);
  const prompt = chapterPrompt({ title: "T", chapters: [{ title: "A", topics: ["x"] }], facts: "Node.js 24 is the current LTS." }, 0);
  assert.match(prompt, /numbered 1, 2, 3/);
  assert.match(prompt, /CURRENT FACTS[\s\S]*Node\.js 24 is the current LTS/);
});
