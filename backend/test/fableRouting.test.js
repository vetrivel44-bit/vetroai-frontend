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

test("Claude Fable 5 backend requests are strict and never use provider fallback", () => {
  assert.match(
    orchestratorSource,
    /const strictFable = String\(preferredProvider \|\| ""\)\.toLowerCase\(\) === "fable"/
  );

  const strictFailure = orchestratorSource.indexOf("if (strictFable) {");
  const fallback = orchestratorSource.indexOf(
    "providerManager.getFallbackProvider(currentProviderName"
  );

  assert.ok(strictFailure >= 0, "Strict Fable failure branch was not found");
  assert.ok(fallback > strictFailure, "Strict Fable failure must stop before provider fallback");
});
