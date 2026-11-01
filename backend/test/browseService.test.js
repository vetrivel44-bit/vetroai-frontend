const test = require("node:test");
const assert = require("node:assert/strict");

const { browseWeb, browseQuery, BROWSE_RULES } = require("../src/services/browseService");

const ARTICLE = "The Pixel 10 Pro camera review found the 5x telephoto sharper than last year's. ".repeat(12);
const FETCHED = "Battery life on the Pixel 10 Pro lasted 9 hours of screen time in our test. ".repeat(10);
const VIDEO_TEXT = "YouTube video: Pixel 10 Pro review — 3 months later\nChannel: MKBHD\nPublished: 2026-10-02 · Length: 14:20\n\nDescription (written by the uploader):\nThree months with the Pixel 10 Pro: camera, battery, Tensor G5.";

const RESULTS = [
  { url: "https://reviews.example/pixel-10-pro", title: "Pixel 10 Pro review", text: ARTICLE, published: "2026-09-30" },
  { url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Pixel 10 Pro review — 3 months later", text: "" },
  { url: "https://battery.example/pixel", title: "Pixel 10 Pro battery test", text: "short" },
  { url: "https://walled.example/pixel", title: "Pixel news", text: "Just a moment... Checking if the site connection is secure. Enable JavaScript and cookies to continue" },
  { url: "https://slow.example/pixel", title: "Slow site", text: "" },
  { url: "https://notopened.example/pixel", title: "Sixth result", text: ARTICLE },
  { url: "https://youtu.be/abcdefghijk", title: "Same video again", text: "" },
];

function run(options = {}) {
  const events = [];
  const reads = [];
  return browseWeb("Find Pixel 10 Pro reviews, including on YouTube, and summarise them\n\n[USER-APPROVED CURRENT LOCATION] Latitude: 1, Longitude: 2.", {
    onEvent: (e) => events.push(e),
    searchFn: async (q) => { events.push({ searched: q }); return RESULTS; },
    readFn: async (url) => {
      reads.push(url);
      if (url.includes("battery.example")) return { status: "read", url, title: "Pixel 10 Pro battery test — Battery Lab", text: FETCHED };
      if (url.includes("slow.example")) return new Promise(() => {}); // never answers
      return { status: "failed", url, reason: "the site could not be reached" };
    },
    youtubeFn: async (url) => ({ status: "read", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Pixel 10 Pro review — 3 months later", text: VIDEO_TEXT, video: { id: "abcdefghijk", channel: "MKBHD", hasTranscript: false } }),
    deadlineMs: 200,
    ...options,
  }).then((out) => ({ out, events, reads }));
}

test("the task is searched without Computer's notes to the model", () => {
  assert.equal(browseQuery("Find Pixel 10 Pro reviews\n\n[ACTION RESULT] The desktop companion opened YouTube."), "Find Pixel 10 Pro reviews");
  assert.equal(browseQuery("  plain   question  "), "plain question");
});

test("the top results are opened and each one's real outcome is reported as it happens", async () => {
  const { out, events, reads } = await run();
  assert.equal(events[0].id, "search-0");
  assert.equal(events[0].status, "searching");
  assert.equal(events[0].query, "Find Pixel 10 Pro reviews, including on YouTube, and summarise them");
  assert.deepEqual(events[1], { searched: events[0].query });
  assert.deepEqual(events[2], { id: "search-0", kind: "search", query: events[0].query, status: "done", found: 6 });

  const final = new Map();
  for (const e of events) if (e.kind === "visit") {
    if (!final.has(e.id)) assert.equal(e.status, "loading", `${e.id} starts as loading`);
    final.set(e.id, e);
  }
  assert.deepEqual([...final.values()].map((e) => [e.domain, e.status, e.reason]), [
    ["reviews.example", "read", null],
    ["youtube.com", "read", null],
    ["battery.example", "read", null],
    ["walled.example", "blocked", "a bot check (Cloudflare) stopped the visit"],
    ["slow.example", "failed", "the page took too long to load"],
  ]);
  // Only the page whose provider text was too short, and the slow one, were fetched here.
  assert.deepEqual(reads, ["https://battery.example/pixel", "https://slow.example/pixel"]);
  assert.match(final.get("page-0").excerpt, /5x telephoto/);
  assert.match(final.get("page-1").excerpt, /^YouTube video: Pixel 10 Pro review/);
  assert.equal(final.get("page-1").video.channel, "MKBHD");
  assert.equal(final.get("page-2").title, "Pixel 10 Pro battery test — Battery Lab");
  assert.equal(final.get("page-3").excerpt, null);
  assert.equal(out.pages.length, 5, "the sixth result and the repeated video are not opened");
});

test("the answer gets only what was read, numbered, with the unreadable pages named but empty", async () => {
  const { out } = await run();
  const ctx = out.context;
  assert.match(ctx, /^VETROAI'S BROWSER FOR THIS TASK/);
  assert.match(ctx, /Searched for "Find Pixel 10 Pro reviews, including on YouTube, and summarise them": 6 results; the top 5 opened\./);
  assert.match(ctx, /\[1\] Pixel 10 Pro review — https:\/\/reviews\.example\/pixel-10-pro \(published 2026-09-30\)\n.*5x telephoto/);
  assert.match(ctx, /\[2\] Pixel 10 Pro review — 3 months later — https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\nYouTube video:/);
  assert.match(ctx, /\[3\] Pixel 10 Pro battery test — Battery Lab — https:\/\/battery\.example\/pixel\n.*9 hours/);
  assert.match(ctx, /OPENED BUT NOT READABLE — no content came from these; never cite or describe them:\n- walled\.example: a bot check \(Cloudflare\) stopped the visit \(https:\/\/walled\.example\/pixel\)\n- slow\.example: the page took too long to load/);
  assert.ok(!/Checking if the site connection is secure/.test(ctx), "the bot check's text never reaches the answer");
  assert.ok(!/Sixth result|notopened/.test(ctx), "results that weren't opened aren't evidence");
  assert.deepEqual(out.results.map((r) => r.url), ["https://reviews.example/pixel-10-pro", "https://www.youtube.com/watch?v=abcdefghijk", "https://battery.example/pixel"]);
});

test("a partly read video is cited with what was missing; nothing read at all is said plainly", async () => {
  const partial = await run({
    searchFn: async () => [RESULTS[1]],
    youtubeFn: async (url) => ({ status: "partial", url, title: "Pixel 10 Pro review", text: "YouTube video: Pixel 10 Pro review\nChannel: MKBHD", reason: "YouTube asked to sign in to confirm it's not a bot, so only the title and channel could be read", video: { id: "abcdefghijk" } }),
  });
  assert.match(partial.out.context, /\[1\] Pixel 10 Pro review — https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\n\(Only partly read: YouTube asked to sign in to confirm it's not a bot, so only the title and channel could be read\.\)/);

  const nothing = await run({ searchFn: async () => [] });
  assert.match(nothing.out.context, /Searched for ".*": 0 results; the top 0 opened\.\n\nPAGES READ: none\. No page could be read for this task\./);
  assert.deepEqual(nothing.out.results, []);

  const searchDown = await run({ searchFn: async () => { throw new Error("Tavily down"); } });
  assert.match(searchDown.out.context, /PAGES READ: none/);
});

test("the answering model is told to answer from what was read", () => {
  for (const rule of [/cite|number after each one, like \[2\]/, /didn't say/, /marked as general knowledge/, /OPENED BUT NOT READABLE gave no content/, /couldn't access what is said in the video/, /If no page could be read, say that first/]) {
    assert.match(BROWSE_RULES, rule);
  }
});
