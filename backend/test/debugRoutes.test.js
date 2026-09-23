const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../src/app");

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function withDebugToken(value, t) {
  const previous = process.env.DEBUG_TOKEN;
  if (value === undefined) delete process.env.DEBUG_TOKEN;
  else process.env.DEBUG_TOKEN = value;
  t.after(() => {
    if (previous === undefined) delete process.env.DEBUG_TOKEN;
    else process.env.DEBUG_TOKEN = previous;
  });
}

test("provider tests are disabled when DEBUG_TOKEN is unset", async (t) => {
  withDebugToken(undefined, t);
  const baseUrl = await startServer(t);
  const res = await fetch(`${baseUrl}/api/debug/test/groq?token=anything`);
  assert.equal(res.status, 404);
});

test("provider tests reject a missing or wrong token", async (t) => {
  withDebugToken("s3cret-token", t);
  const baseUrl = await startServer(t);
  assert.equal((await fetch(`${baseUrl}/api/debug/test/groq`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/debug/test/groq?token=wrong-token!`)).status, 404);
});

test("the right token gets through to the provider lookup", async (t) => {
  withDebugToken("s3cret-token", t);
  const baseUrl = await startServer(t);
  const res = await fetch(`${baseUrl}/api/debug/test/not-a-provider?token=s3cret-token`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.error, "Provider adapter not found");
  assert.ok(body.available.includes("groq"));

  const viaHeader = await fetch(`${baseUrl}/api/debug/test/not-a-provider`, { headers: { "x-debug-token": "s3cret-token" } });
  assert.equal((await viaHeader.json()).error, "Provider adapter not found");
});
