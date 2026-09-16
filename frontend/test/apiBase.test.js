import test from "node:test";
import assert from "node:assert/strict";

import { resolveApiBase } from "../src/lib/apiBase.js";

const PROD_DEFAULT = "https://ai-chatbot-backend-gvvz.onrender.com/api";

// The bug this guards: the deployed VITE_API_BASE_URL is the bare origin, so a
// caller that used it verbatim posted to /chat instead of /api/chat and got
// "Route not found" for every request in production.
test("an origin without /api gets the suffix added", () => {
  assert.equal(
    resolveApiBase("https://ai-chatbot-backend-gvvz.onrender.com", true, PROD_DEFAULT),
    "https://ai-chatbot-backend-gvvz.onrender.com/api"
  );
});

test("an origin that already ends in /api is left alone", () => {
  assert.equal(
    resolveApiBase("https://ai-chatbot-backend-gvvz.onrender.com/api", true, PROD_DEFAULT),
    "https://ai-chatbot-backend-gvvz.onrender.com/api"
  );
});

test("trailing slashes never produce a doubled separator", () => {
  assert.equal(
    resolveApiBase("https://example.com/", true, PROD_DEFAULT),
    "https://example.com/api"
  );
  assert.equal(
    resolveApiBase("https://example.com/api///", true, PROD_DEFAULT),
    "https://example.com/api"
  );
});

// UpgradeModal, CallAssistantLauncher and VoiceCoverLauncher each tested for
// the /api suffix *before* stripping trailing slashes, so a configured
// ".../api/" became ".../api/api" and 404'd every request they made.
test("a suffixed origin with a trailing slash is not doubled to /api/api", () => {
  assert.equal(
    resolveApiBase("https://ai-chatbot-backend-gvvz.onrender.com/api/", true, PROD_DEFAULT),
    "https://ai-chatbot-backend-gvvz.onrender.com/api"
  );
});

test("the /api suffix check is case-insensitive", () => {
  assert.equal(resolveApiBase("https://example.com/API", true, PROD_DEFAULT), "https://example.com/API");
});

test("dev falls back to the relative path Vite proxies, not the prod origin", () => {
  assert.equal(resolveApiBase(undefined, false, PROD_DEFAULT), "/api");
  assert.equal(resolveApiBase("   ", false, PROD_DEFAULT), "/api");
});

test("prod with nothing configured uses the production default", () => {
  assert.equal(resolveApiBase(undefined, true, PROD_DEFAULT), PROD_DEFAULT);
});
