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
    const body = JSON.parse(init.body);
    bodies.push(body);
    const ask = body.messages[body.messages.length - 1].content;
    const chapter = /Write Chapter (\d+): (.+)/.exec(ask);
    const content = chapter
      ? `## Chapter ${chapter[1]}: ${chapter[2]}\n\nExplained simply.\n\n### Recap\n- Done.`
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
  assert.equal(bodies.length, 7, "one outline + one call per chapter");
  // Each chapter is its own short request, without the ~10k-token chat prompt,
  // and asks for no separate reasoning pass.
  for (const b of bodies) {
    assert.ok(b.messages[0].content.length < 2000);
    assert.equal(b.reasoning_effort, null);
  }
  // Later chapters are told what came before, so they don't repeat it.
  assert.match(bodies.find((b) => /Write Chapter 4:/.test(b.messages[1].content)).messages[1].content, /Already taught[\s\S]*3\. Topic 3/);
});
