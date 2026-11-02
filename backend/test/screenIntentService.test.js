const test = require("node:test");
const assert = require("node:assert/strict");

const intent = require("../src/services/screenIntentService");
const app = require("../src/app");

function withJudge(t, decide) {
  const asked = [];
  intent.clearCache();
  intent.setModel(async (messages) => { asked.push(messages); return decide(messages); });
  t.after(() => { intent.setModel(async () => { throw new Error("no model in tests"); }); intent.clearCache(); });
  return asked;
}

// Phrasings the app's word patterns don't know. As chat answers they only
// described doing the task; the judge reads them as a person would.
test("tasks the patterns miss are judged by the model", async (t) => {
  const asked = withJudge(t, (m) => (/spotify|chrome la|kholo|dark mode/i.test(m[1].content) ? "SCREEN" : "CHAT"));
  assert.deepEqual(await intent.decideScreen({ text: "pull up spotify and put on some lofi" }), { screen: true, by: "model" });
  assert.deepEqual(await intent.decideScreen({ text: "chrome la weather paaru" }), { screen: true, by: "model" });
  assert.deepEqual(await intent.decideScreen({ text: "youtube kholo" }), { screen: true, by: "model" });
  assert.deepEqual(await intent.decideScreen({ text: "write an email to my boss asking for leave" }), { screen: false, by: "model" });
  assert.equal(asked.length, 4);
  const [system, user] = asked[0];
  assert.match(system.content, /Answer SCREEN when doing the task means using the computer itself/);
  assert.match(system.content, /Tamil or Hindi typed in English letters/);
  assert.equal(user.content, "Task: pull up spotify and put on some lofi");
});

test("small talk, questions about VetroAI and follow-ups need no model", async (t) => {
  const asked = withJudge(t, () => "SCREEN");
  for (const text of ["hi", "thank u", "Ur name", "who r u", "in tamil", "give eg", ""]) {
    assert.deepEqual(await intent.decideScreen({ text }), { screen: false, by: "rules" }, text);
  }
  assert.equal(asked.length, 0);
});

test("text-speak is shown to the judge in plain words too; a repeated task is asked once", async (t) => {
  const asked = withJudge(t, () => "SCREEN");
  await intent.decideScreen({ text: "pls open d downloads folder rn" });
  assert.match(asked[0][1].content, /^Task: pls open d downloads folder rn\n\(In plain words: please open d downloads folder right now\)$/);
  const again = await intent.decideScreen({ text: "PLS open d downloads folder rn" });
  assert.equal(asked.length, 1);
  assert.equal(again.cached, true);
});

test("when the judge can't say, the app's patterns decide", async (t) => {
  withJudge(t, () => "maybe");
  assert.deepEqual(await intent.decideScreen({ text: "pull up spotify" }), { screen: null, by: "unavailable", reason: "unclear reply" });
  intent.setModel(async () => { throw new Error("rate limited"); });
  assert.deepEqual(await intent.decideScreen({ text: "pull up vlc" }), { screen: null, by: "unavailable", reason: "rate limited" });
  intent.setModel(() => new Promise(() => {}));
  const started = Date.now();
  const slow = await intent.decideScreen({ text: "pull up telegram" });
  assert.equal(slow.screen, null);
  assert.ok(Date.now() - started < intent.DECIDE_TIMEOUT_MS + 1000);
});

test("POST /api/screen-intent gives the app the decision", async (t) => {
  withJudge(t, (m) => (/spotify/.test(m[1].content) ? "SCREEN" : "CHAT"));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const post = async (text) => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/screen-intent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  })).json()).data;
  assert.deepEqual(await post("pull up spotify and put on some lofi"), { screen: true, by: "model" });
  assert.deepEqual(await post("explain how chrome extensions work"), { screen: false, by: "model" });
  assert.deepEqual(await post("hi"), { screen: false, by: "rules" });
});
