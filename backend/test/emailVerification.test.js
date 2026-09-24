const test = require("node:test");
const assert = require("node:assert/strict");

// Stand-in for the signature check, so the middleware sees a token that
// verifies and the test can control its claims.
const tokenPath = require.resolve("../src/utils/firebaseToken");
const real = require(tokenPath);
let claims = {};
require.cache[tokenPath].exports = { ...real, isFirebaseIdToken: () => true, verifyFirebaseIdToken: async () => claims };
delete require.cache[require.resolve("../src/middleware/authMiddleware")];
const authMiddleware = require("../src/middleware/authMiddleware");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = `${b64({ alg: "RS256" })}.${b64({ iss: "https://securetoken.google.com/x" })}.sig`;

async function run(tokenClaims) {
  claims = tokenClaims;
  const req = { headers: { authorization: `Bearer ${token}` } };
  // asyncHandler reports through next() rather than a returned promise.
  const err = await new Promise((resolve) => authMiddleware(req, {}, (e) => resolve(e || null)));
  return { error: err, passed: !err, user: req.user };
}

test("an email + password account that hasn't verified its email is refused", async () => {
  const { error, passed } = await run({ sub: "u1", email: "fake@nowhere.test", email_verified: false, firebase: { sign_in_provider: "password" } });
  assert.equal(passed, false);
  assert.equal(error?.statusCode, 403);
  assert.match(error.message, /verify your email/i);
});

test("a verified email + password account is let in", async () => {
  const { error, passed, user } = await run({ sub: "u2", email: "real@example.com", email_verified: true, firebase: { sign_in_provider: "password" } });
  assert.equal(error, null);
  assert.equal(passed, true);
  assert.equal(user.email, "real@example.com");
});

test("Google sign-ins are let in", async () => {
  const { passed } = await run({ sub: "u3", email: "g@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  assert.equal(passed, true);
});

test("the old unverified sign-up route is closed", async () => {
  const { signup } = require("../src/controllers/authController");
  await assert.rejects(signup({ validated: { body: { email: "a@b.test", password: "Password1", name: "A" } } }, {}), (err) => err.statusCode === 410);
});
