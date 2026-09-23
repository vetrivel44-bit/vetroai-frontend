const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const { parseBirthDetails, isAstrologyConversation, buildAstrologyContext } = require("../src/services/astrologyContext");

test("parseBirthDetails reads common formats without Groq", () => {
  assert.deepEqual(parseBirthDetails("I was born on 5 March 1998 at 10:30 am in Chennai"),
    { day: 5, month: 3, year: 1998, hour: 10, minute: 30, city: "Chennai" });
  assert.deepEqual(parseBirthDetails("March 5th, 1998, 10.30pm, born in New Delhi"),
    { month: 3, day: 5, year: 1998, hour: 22, minute: 30, city: "New Delhi" });
  assert.deepEqual(parseBirthDetails("dob 05/03/1998 22:15 place: Pune"),
    { day: 5, month: 3, year: 1998, hour: 22, minute: 15, city: "Pune" });
  assert.deepEqual(parseBirthDetails("1998-03-05 in Mumbai"), { year: 1998, month: 3, day: 5, city: "Mumbai" });
});

test("isAstrologyConversation covers Indian terms and birth-detail follow-ups", () => {
  assert.equal(isAstrologyConversation([], "what is my rasi?"), true);
  assert.equal(isAstrologyConversation([], "show my jathagam"), true);
  assert.equal(isAstrologyConversation([], "my kundali please"), true);
  assert.equal(isAstrologyConversation([], "what is the capital of France"), false);
  const followUp = [
    { role: "user", content: "tell me my horoscope" },
    { role: "assistant", content: "Please share your birth date, time of birth and city of birth." },
    { role: "user", content: "5 March 1998, 10:30 am, Chennai" },
  ];
  assert.equal(isAstrologyConversation(followUp, "5 March 1998, 10:30 am, Chennai"), true);
  assert.equal(isAstrologyConversation([{ role: "user", content: "meeting on 5 March 2026" }], "meeting on 5 March 2026"), false);
});

test("buildAstrologyContext asks for details, then grounds on ProKerala data with the chart", async (t) => {
  const missing = await buildAstrologyContext([{ role: "user", content: "what is my horoscope?" }], "what is my horoscope?");
  assert.equal(missing.status, "missing");
  assert.match(missing.prompt, /ask the user for their birth date/);

  assert.equal((await buildAstrologyContext([{ role: "user", content: "hi" }], "hi")).status, "none");

  config.prokeralaClientId = "id"; config.prokeralaClientSecret = "secret";
  const realFetch = global.fetch;
  const hits = [];
  global.fetch = async (url) => {
    const u = String(url); hits.push(u.split("?")[0]);
    if (u.includes("nominatim")) return Response.json([{ lat: "13.08", lon: "80.27" }]);
    if (u.includes("/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (u.includes("/chart")) return new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { headers: { "content-type": "image/svg+xml" } });
    return Response.json({ data: { ok: true, path: u.split("?")[0] } });
  };
  t.after(() => { global.fetch = realFetch; });

  const msgs = [{ role: "user", content: "My kundli: born 5 March 1998 at 10:30 am in Chennai" }];
  const ok = await buildAstrologyContext(msgs, msgs[0].content);
  assert.equal(ok.status, "ok");
  assert.match(ok.prompt, /LIVE ASTROLOGY API DATA/);
  assert.match(ok.chartBlock, /visual_gallery/);
  assert.ok(hits.some((h) => h.endsWith("/kundli")) && hits.some((h) => h.endsWith("/planet-position")));
});

test("POST /api/astrology/context answers for any model", async (t) => {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const post = (messages) => fetch(`http://127.0.0.1:${server.address().port}/api/astrology/context`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }),
  }).then((r) => r.json());

  const none = await post([{ role: "user", content: "hello" }]);
  assert.equal(none.astrology, false);
  const missing = await post([{ role: "user", content: "what's my rasi palan?" }]);
  assert.equal(missing.astrology, true);
  assert.equal(missing.status, "missing");
});
