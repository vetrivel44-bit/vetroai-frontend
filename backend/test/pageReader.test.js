const test = require("node:test");
const assert = require("node:assert/strict");

const http = require("node:http");
const zlib = require("node:zlib");
const { fetchPageText, guardedFetch, publicOnlyLookup, htmlToText, keyTerms, splitPassages, bestPassages } = require("../src/services/pageReader");

const ARTICLE_HTML = `<!doctype html><html><head><title>T</title><style>.x{color:red}</style><script>var tracking = 1;</script></head>
<body>
  <header><nav><a href="/">Home</a><a href="/news">News</a></nav></header>
  <article>
    <h1>SECI solar auction results</h1>
    <p>The auction cleared at a tariff of &#8377;2.48 per kWh &mdash; a record low.</p>
    <p>Developers said module prices &amp; financing costs drove the bids down.</p>
    <ul><li>Capacity: 1,200 MW</li><li>Winning bidder: Example Power</li></ul>
    <p>${"More background on the market and its history. ".repeat(20)}</p>
  </article>
  <aside>Related stories you might like</aside>
  <footer>© 2026 Example News. All rights reserved.</footer>
  <form><input name="email"><button>Subscribe</button></form>
</body></html>`;

test("page HTML becomes readable text, without scripts, menus, sidebars or footers", () => {
  const text = htmlToText(ARTICLE_HTML);
  assert.match(text, /SECI solar auction results/);
  assert.match(text, /tariff of ₹2\.48 per kWh — a record low\./);
  assert.match(text, /module prices & financing costs/);
  assert.match(text, /• Capacity: 1,200 MW\n• Winning bidder: Example Power/);
  for (const junk of ["tracking", "color:red", "Home", "Related stories", "All rights reserved", "Subscribe"]) {
    assert.ok(!text.includes(junk), junk);
  }
});

test("a page without an <article> keeps its whole body", () => {
  const text = htmlToText("<html><body><div><p>First paragraph here.</p><p>Second &quot;quoted&quot; one.</p></div></body></html>");
  assert.equal(text, "First paragraph here.\nSecond \"quoted\" one.");
});

test("hostile HTML (unclosed comments, menus and tags) is read in linear time", () => {
  const size = 1_500_000;
  for (const unit of ["<!--", "<nav>", "<", "<li", "<article>", "<script>x", "</p", "&#x"]) {
    const html = `<body><p>Start.</p>${unit.repeat(Math.ceil(size / unit.length))}`;
    const started = process.hrtime.bigint();
    htmlToText(html);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2000, `${JSON.stringify(unit)} took ${Math.round(ms)}ms`);
  }
});

test("an unterminated comment hides the rest of the page, as in a browser", () => {
  assert.equal(htmlToText("<body><p>Kept text.</p><!-- <p>hidden</p>"), "Kept text.");
  assert.equal(htmlToText("<body><nav>menu</nav><p>Body <nav>stays when the nav never closes"), "Body stays when the nav never closes");
});

test("key terms drop filler words and keep numbers", () => {
  assert.deepEqual([...keyTerms("What is the solar tariff in India for 2026, at 2.48?")].sort(), ["2.48", "2026", "india", "solar", "tariff"]);
});

test("passages are paragraph-sized, and walls of text are cut at sentence ends", () => {
  const wall = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about something.`).join(" ");
  const passages = splitPassages(`Short heading\nA normal paragraph that is long enough to keep as a passage.\n${wall}`);
  assert.ok(passages.length > 2);
  assert.ok(passages.every((p) => p.length <= 1000));
  assert.ok(passages.slice(1).every((p) => /\.$/.test(p)));
});

test("the passages that answer the question are picked, in page order", () => {
  // Real paragraphs, long enough that each is its own passage.
  const pad = " It was reported by several outlets and discussed at length by analysts, who looked at what it means for developers, buyers and the grid over the coming years.";
  const text = [
    "Welcome to our site. We cover energy news every day of the week for our readers.",
    "Wind tariffs in 2026 rose to ₹3.2 per kWh in the latest auctions held in India.",
    "Our editorial team is based in Delhi and has reported on the industry since 2010.",
    "Solar tariffs in India hit ₹2.48 per kWh in 2026, a record low for any auction.",
  ].map((p) => p + pad).join("\n\n");
  const { passages, score } = bestPassages(text, keyTerms("solar tariff india 2026"), { max: 2 });
  assert.ok(score > 0);
  assert.equal(passages.length, 2);
  assert.match(passages[0], /Wind tariffs/, "page order is kept");
  assert.match(passages[1], /Solar tariffs in India hit ₹2\.48/);
  assert.deepEqual(bestPassages(text, keyTerms("quantum chromodynamics")).passages, []);
});

// ── Fetching ─────────────────────────────────────────────────────────────────
const publicDns = async () => [{ address: "93.184.216.34" }];
const htmlResponse = (body, init = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

test("a public page is fetched and turned into text", async () => {
  const seen = [];
  const text = await fetchPageText("https://news.example/solar", {
    lookup: publicDns,
    fetchImpl: async (url, init) => { seen.push({ url, redirect: init.redirect }); return htmlResponse(ARTICLE_HTML); },
  });
  assert.match(text, /₹2\.48 per kWh/);
  assert.deepEqual(seen, [{ url: "https://news.example/solar", redirect: "manual" }]);
});

test("private, loopback and metadata addresses are never fetched, even through a redirect", async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return htmlResponse(ARTICLE_HTML); };
  assert.equal(await fetchPageText("http://169.254.169.254/latest/meta-data", { fetchImpl, lookup: publicDns }), null);
  assert.equal(await fetchPageText("http://intranet.example/", { fetchImpl, lookup: async () => [{ address: "10.0.0.5" }] }), null);
  assert.equal(await fetchPageText("file:///etc/passwd", { fetchImpl, lookup: publicDns }), null);
  assert.equal(fetched, 0);

  const lookup = async (host) => [{ address: host === "evil.example" ? "93.184.216.34" : "127.0.0.1" }];
  const redirecting = async (url) => {
    fetched += 1;
    return url.includes("evil.example")
      ? new Response(null, { status: 302, headers: { location: "http://localhost:3000/admin" } })
      : htmlResponse(ARTICLE_HTML);
  };
  assert.equal(await fetchPageText("https://evil.example/go", { fetchImpl: redirecting, lookup }), null);
  assert.equal(fetched, 1, "the redirect to localhost was not followed");
});

test("redirects between public pages are followed", async () => {
  const text = await fetchPageText("https://short.example/x", {
    lookup: publicDns,
    fetchImpl: async (url) => (url.includes("short.example")
      ? new Response(null, { status: 301, headers: { location: "https://news.example/solar" } })
      : htmlResponse(ARTICLE_HTML)),
  });
  assert.match(text, /record low/);
});

test("errors, non-text files and near-empty pages give nothing", async () => {
  const cases = [
    new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
    new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } }),
    htmlResponse("<html><body><p>Too short.</p></body></html>"),
  ];
  for (const response of cases) {
    assert.equal(await fetchPageText("https://news.example/x", { lookup: publicDns, fetchImpl: async () => response }), null);
  }
  assert.equal(await fetchPageText("https://news.example/x", { lookup: publicDns, fetchImpl: async () => { throw new Error("timeout"); } }), null);
});

// ── The socket-level guard (DNS rebinding) ──────────────────────────────────
const fakeResolve = (answers) => (host, opts, cb) => cb(null, answers);

test("the socket lookup refuses a name with any non-public answer", async () => {
  const lookupWith = (answers, opts = {}) => new Promise((resolve) => {
    publicOnlyLookup({ resolve: fakeResolve(answers) })("site.example", opts, (err, address, family) => resolve({ err, address, family }));
  });
  assert.equal((await lookupWith([{ address: "127.0.0.1", family: 4 }])).err.code, "ENONPUBLIC");
  assert.equal((await lookupWith([{ address: "::ffff:7f00:1", family: 6 }])).err.code, "ENONPUBLIC");
  assert.equal((await lookupWith([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }])).err.code, "ENONPUBLIC");
  assert.equal((await lookupWith([])).err.code, "ENONPUBLIC");
  assert.deepEqual(await lookupWith([{ address: "93.184.216.34", family: 4 }]), { err: null, address: "93.184.216.34", family: 4 });
  const all = await lookupWith([{ address: "93.184.216.34", family: 4 }], { all: true });
  assert.deepEqual(all.address, [{ address: "93.184.216.34", family: 4 }]);
});

function localServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("a name that resolves to a private address at connect time is never connected to", async () => {
  let hits = 0;
  const server = await localServer((req, res) => { hits += 1; res.end("internal"); });
  try {
    const { port } = server.address();
    // The default guard: "localhost" answers 127.0.0.1 when the socket connects.
    await assert.rejects(guardedFetch(`http://localhost:${port}/admin`), (err) => err.code === "ENONPUBLIC");
    // An IP address is never looked up, so it is checked before connecting.
    for (const host of ["127.0.0.1", "[::ffff:7f00:1]", "[::1]"]) {
      await assert.rejects(guardedFetch(`http://${host}:${port}/admin`), (err) => err.code === "ENONPUBLIC", host);
    }
    // fetchPageText's up-front check passes (a rebinding name answers "public"
    // first), but the connection itself is still refused.
    const text = await fetchPageText(`http://rebind.example:${port}/admin`, {
      lookup: async () => [{ address: "93.184.216.34" }],
      fetchImpl: (href, init) => guardedFetch(href, init, { resolve: fakeResolve([{ address: "127.0.0.1", family: 4 }]) }),
    });
    assert.equal(text, null);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});

test("guardedFetch answers a standard Response with the body decompressed", async () => {
  const page = `<html><body><article><p>${"Compressed article text about solar tariffs. ".repeat(30)}</p></article></body></html>`;
  const server = await localServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "set-cookie": "a=b" });
    res.end(zlib.gzipSync(page));
  });
  try {
    const { port } = server.address();
    // Allowed here only because the test server is on loopback.
    const response = await guardedFetch(`http://127.0.0.1:${port}/`, {}, { isAllowed: () => true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(await response.text(), page);

    const text = await fetchPageText(`http://allowed.example:${port}/`, {
      lookup: async () => [{ address: "93.184.216.34" }],
      fetchImpl: (href, init) => guardedFetch(href.replace("allowed.example", "127.0.0.1"), init, { isAllowed: () => true }),
    });
    assert.match(text, /Compressed article text about solar tariffs\./);
  } finally {
    server.close();
  }
});

test("a cancelled research stops reading pages", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = 0;
  const text = await fetchPageText("https://news.example/x", {
    lookup: publicDns,
    signal: controller.signal,
    fetchImpl: async () => { fetched += 1; return htmlResponse(ARTICLE_HTML); },
  });
  assert.equal(text, null);
  assert.equal(fetched, 0);
});
