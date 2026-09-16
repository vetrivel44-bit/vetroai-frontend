const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(repositoryRoot, "frontend/src/App.jsx"), "utf8");
const orchestratorSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/src/services/AIOrchestrator.js"),
  "utf8"
);

test("Claude Fable 5 is excluded from every Puter text model route", () => {
  const puterMap = appSource.match(/const PUTER_MODEL_IDS = \{([\s\S]*?)\n\};/)?.[1] || "";
  assert.ok(puterMap, "Puter model map was not found");
  assert.doesNotMatch(puterMap, /fable|claude/i);
  // The provider field sent to the backend must map Fable to the strict "fable"
  // route, ahead of any other provider mapping in the same expression.
  assert.match(
    appSource,
    /fd\.append\(\s*"provider",\s*selectedProvider === CLAUDE_FABLE_PROVIDER \? "fable"/
  );
});

test("Claude Fable 5 cannot fall through to Puter image analysis", () => {
  const fableGuard = appSource.indexOf(
    "selectedProvider === CLAUDE_FABLE_PROVIDER && attachedImages.length > 0"
  );
  const puterImageRoute = appSource.indexOf("if (attachedImages.length > 0)", fableGuard + 1);

  assert.ok(fableGuard >= 0, "Fable image guard was not found");
  assert.ok(puterImageRoute > fableGuard, "Fable guard must run before Puter image analysis");
});

test("Claude Fable 5 backend requests go through the normal provider fallback chain", () => {
  // A dedicated "strictFable" no-fallback carve-out used to stop a Fable
  // request from ever trying another provider — including Cohere — when
  // Fable itself was out of quota. That's gone: an explicit "fable" pick now
  // goes through providerManager.getBestProvider/getFallbackProvider like
  // any other provider selection, so it can still get an answer.
  assert.doesNotMatch(orchestratorSource, /strictFable/);
  assert.match(orchestratorSource, /providerManager\.getBestProvider\(mode, preferredProvider\)/);
});
