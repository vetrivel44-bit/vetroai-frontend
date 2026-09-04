const test = require("node:test");
const assert = require("node:assert/strict");

const { redactHeaders, redactBody } = require("../src/middleware/debugMiddleware");

test("credential headers never reach the log", () => {
  const safe = redactHeaders({
    host: "api.example.com",
    authorization: "Bearer eyJhbGciOi.secret.value",
    cookie: "session=abc",
    "x-rapidapi-key": "rapid-secret",
    "user-agent": "curl/8",
  });

  assert.equal(safe.authorization, "[redacted]");
  assert.equal(safe.cookie, "[redacted]");
  assert.equal(safe["x-rapidapi-key"], "[redacted]");
  assert.equal(safe.host, "api.example.com", "harmless headers are kept");
  assert.equal(safe["user-agent"], "curl/8");
});

test("passwords and tokens never reach the log, at any nesting depth", () => {
  const safe = redactBody({
    email: "user@example.com",
    password: "hunter2",
    refreshToken: "rt_secret",
    profile: { name: "Ada", currentPassword: "old-one" },
    sessions: [{ accessToken: "at_secret", mode: "normal" }],
  });

  assert.equal(safe.password, "[redacted]");
  assert.equal(safe.refreshToken, "[redacted]");
  assert.equal(safe.profile.currentPassword, "[redacted]");
  assert.equal(safe.sessions[0].accessToken, "[redacted]");
  assert.equal(safe.email, "user@example.com", "non-secret fields survive");
  assert.equal(safe.profile.name, "Ada");
  assert.equal(safe.sessions[0].mode, "normal");
});

test("redaction tolerates non-object bodies", () => {
  assert.equal(redactBody(undefined), undefined);
  assert.equal(redactBody("plain string"), "plain string");
  assert.deepEqual(redactHeaders(undefined), {});
});
