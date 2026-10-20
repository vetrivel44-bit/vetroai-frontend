const test = require("node:test");
const assert = require("node:assert/strict");

// A fixed "live" search result, standing in for the real search (set before
// the orchestrator is loaded, since it takes searchWeb when it is required).
const searchController = require("../src/controllers/searchController");
const FRESH = "[1] Apple iPhone 17 Pro — launched 9 Sept 2026, ₹1,34,900 in India (apple.com/in)";
searchController.searchWeb = async () => ({
  context: `SOURCES:\n${FRESH}`,
  results: [{ title: "iPhone 17 Pro", url: "https://www.apple.com/in/iphone-17-pro/", snippet: FRESH }],
});

const { config } = require("../src/config/env");
const app = require("../src/app");

async function webSearchChat(t, provider, apiHost) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const realFetch = global.fetch;
  let sent = null;
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (href.startsWith(apiHost) && !sent) sent = JSON.parse(init.body);
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "The iPhone 17 Pro costs ₹1,34,900 [1]." } }] })}\n\n`;
    return new Response(frame + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  t.after(() => { global.fetch = realFetch; });

  await (await realFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "What is the latest iPhone price in India?", provider, modelLabel: provider, mode: "web_search" }),
  })).text();
  return sent;
}

test("Sarvam gets the live results with the question, dated, and told they beat its memory", async (t) => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "test-key";
  t.after(() => { config.sarvamApiKey = saved; });

  const sent = await webSearchChat(t, "Sarvam 105B", "https://api.sarvam.ai/");
  assert.ok(sent, "Sarvam was asked");
  const system = sent.messages[0];
  const question = sent.messages[sent.messages.length - 1];

  assert.equal(system.role, "system");
  assert.doesNotMatch(system.content, /LIVE SEARCH RESULTS/, "not buried in the system prompt");
  assert.equal(question.role, "user");
  assert.match(question.content, /^LIVE SEARCH RESULTS — fetched just now/);
  assert.match(question.content, /Today is /);
  assert.ok(question.content.includes(FRESH));
  assert.match(question.content, /out of date/);
  assert.match(question.content, /My question: What is the latest iPhone price in India\?$/);
});

test("other models still get the results in the system prompt, as before", async (t) => {
  const saved = config.mistralApiKey;
  config.mistralApiKey = "test-key";
  t.after(() => { config.mistralApiKey = saved; });

  const sent = await webSearchChat(t, "Mistral", "https://api.mistral.ai/");
  assert.ok(sent, "Mistral was asked");
  assert.match(sent.messages[0].content, /LIVE SEARCH RESULTS/);
  assert.ok(sent.messages[0].content.includes(FRESH));
  assert.equal(sent.messages[sent.messages.length - 1].content, "What is the latest iPhone price in India?");
});
