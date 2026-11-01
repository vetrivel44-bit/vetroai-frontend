const test = require("node:test");
const assert = require("node:assert/strict");

const { readPage, fetchPageText, detectWall, pageTitle } = require("../src/services/pageReader");

const publicDns = async () => [{ address: "93.184.216.34" }];
const html = (body, init = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const page = (title, bodyText) => html(`<!doctype html><html><head><title>${title}</title></head><body><main><p>${bodyText}</p></main></body></html>`);
const read = (url, response) => readPage(url, { lookup: publicDns, fetchImpl: async () => (typeof response === "function" ? response() : response) });

const ARTICLE = `${"The engine reached a new rating record after the latest release, according to the test suite results. ".repeat(40)}`;

test("YouTube's 'confirm you're not a bot' page is a wall, not the video", async () => {
  const wall = "Sign in to confirm you’re not a bot\nThis helps protect our community. Learn more\nSign in";
  assert.equal(detectWall({ url: "https://www.youtube.com/watch?v=abc", text: wall }), "YouTube asked to sign in to confirm it's not a bot");
  const result = await read("https://www.youtube.com/watch?v=abc", page("YouTube", `${wall} ${"·".repeat(300)}`));
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /not a bot/);
  // fetchPageText (DeepSearch) gets nothing from it.
  assert.equal(await fetchPageText("https://www.youtube.com/watch?v=abc", { lookup: publicDns, fetchImpl: async () => page("YouTube", `${wall} ${"·".repeat(300)}`) }), null);
});

test("cookie-consent, bot-check, CAPTCHA, sign-in and paywall pages are walls", () => {
  const cases = [
    [{ text: "Before you continue to YouTube We use cookies and data to deliver and maintain services" }, /cookie-consent/],
    [{ title: "Just a moment...", text: "Checking if the site connection is secure. Enable JavaScript and cookies to continue" }, /Cloudflare/],
    [{ text: "Our systems have detected unusual traffic from your computer network." }, /unusual traffic/],
    [{ text: "Please verify you are a human. Press & Hold to confirm you are a human (and not a bot)." }, /CAPTCHA/],
    [{ text: "Join now to see who you already know. Sign in to view the full profile." }, /sign in/],
    [{ text: "Subscribe to continue reading. Already a subscriber? Log in." }, /paywall/],
    [{ text: "You need to enable JavaScript to run this app." }, /JavaScript/],
  ];
  for (const [input, reason] of cases) assert.match(detectWall(input) || "", reason, JSON.stringify(input));
});

test("sign-in, consent and 'unusual traffic' addresses are walls by their URL", () => {
  assert.match(detectWall({ url: "https://accounts.google.com/ServiceLogin?continue=x" }), /Google sign-in/);
  assert.match(detectWall({ url: "https://consent.youtube.com/m?continue=https://www.youtube.com/watch" }), /cookie-consent/);
  assert.match(detectWall({ url: "https://www.google.com/sorry/index?continue=x" }), /unusual traffic/);
  assert.match(detectWall({ url: "https://www.linkedin.com/authwall?trk=x" }), /sign-in page/);
  assert.match(detectWall({ url: "https://x.com/i/flow/login" }), /sign-in page/);
  assert.equal(detectWall({ url: "https://www.example.com/blog/signing-in-safely" }), null);
});

test("a long article that only mentions captchas or signing in is still an article", () => {
  const text = `${ARTICLE}\nHow sites use a CAPTCHA: some ask you to verify you are human. Others say "sign in to continue".`;
  assert.ok(text.length > 2500);
  assert.equal(detectWall({ url: "https://news.example/captchas", title: "How CAPTCHAs work", text }), null);
});

test("a redirect to a sign-in page is reported as blocked without fetching it", async () => {
  const fetched = [];
  const result = await readPage("https://www.youtube.com/watch?v=abc", {
    lookup: publicDns,
    fetchImpl: async (url) => {
      fetched.push(url);
      return new Response(null, { status: 302, headers: { location: "https://consent.youtube.com/m?continue=x" } });
    },
  });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /cookie-consent/);
  assert.deepEqual(fetched, ["https://www.youtube.com/watch?v=abc"]);
});

test("a real page is read, with its title and final address", async () => {
  const result = await read("https://news.example/engine", page("Engine release notes — News", ARTICLE));
  assert.equal(result.status, "read");
  assert.equal(result.title, "Engine release notes — News");
  assert.equal(result.url, "https://news.example/engine");
  assert.match(result.text, /new rating record/);
});

test("refusals are blocked; errors, timeouts and empty pages are failed, each with a reason", async () => {
  assert.deepEqual(
    [await read("https://a.example/", html("no", { status: 403 })), await read("https://a.example/", html("no", { status: 429 })), await read("https://a.example/", html("no", { status: 401 }))].map((r) => [r.status, r.reason]),
    [["blocked", "the site refused automated visits (HTTP 403)"], ["blocked", "the site refused automated visits (HTTP 429)"], ["blocked", "the page needs a sign-in (HTTP 401)"]],
  );
  assert.deepEqual([(await read("https://a.example/", html("x", { status: 404 }))).status, (await read("https://a.example/", html("x", { status: 404 }))).reason], ["failed", "the page wasn't found (HTTP 404)"]);
  const pdf = await read("https://a.example/f.pdf", new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }));
  assert.deepEqual([pdf.status, pdf.reason], ["failed", "it isn't a web page (application/pdf)"]);
  const empty = await read("https://a.example/", page("Empty", "Hi."));
  assert.deepEqual([empty.status, empty.reason], ["failed", "the page had almost no readable text"]);
  const slow = await read("https://a.example/", () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; });
  assert.deepEqual([slow.status, slow.reason], ["failed", "the page took too long to load"]);
  const privateHost = await readPage("http://10.0.0.1/", { lookup: async () => [{ address: "10.0.0.1" }], fetchImpl: async () => page("x", ARTICLE) });
  assert.equal(privateHost.status, "failed");
});

test("page titles are read from the head, entities decoded", () => {
  assert.equal(pageTitle("<html><head><title>  Tom &amp; Jerry —\n  Wiki </title></head></html>"), "Tom & Jerry — Wiki");
  assert.equal(pageTitle("<p>no title</p>"), "");
});
