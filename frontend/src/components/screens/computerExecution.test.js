import test from "node:test";
import assert from "node:assert/strict";

import {
  availableWorkspaceContextSlots,
  formatWorkspaceCompletion,
  normalizeWorkspacePath,
  parseWorkspaceManifest,
  requiresWorkspace,
  sanitizeProgressStatus,
  shouldIgnoreWorkspaceDirectory,
} from "./computerExecution.js";

test("recognizes tasks that require a writable workspace", () => {
  assert.equal(requiresWorkspace("Create a website for my portfolio"), true);
  assert.equal(requiresWorkspace("Fix the mobile UI in this project"), true);
  assert.equal(requiresWorkspace("Research the latest AI agents"), false);
});

test("hides internal provider routing details", () => {
  assert.equal(sanitizeProgressStatus("Re-routing to mistral..."), "Processing with an available model…");
  assert.equal(sanitizeProgressStatus("Reading attached files"), "Reading attached files");
});

test("skips dependency, cache, and build directories", () => {
  assert.equal(shouldIgnoreWorkspaceDirectory("node_modules"), true);
  assert.equal(shouldIgnoreWorkspaceDirectory(".git"), true);
  assert.equal(shouldIgnoreWorkspaceDirectory("src"), false);
});

test("keeps workspace context within the backend upload limit", () => {
  assert.equal(availableWorkspaceContextSlots(0), 10);
  assert.equal(availableWorkspaceContextSlots(4), 6);
  assert.equal(availableWorkspaceContextSlots(10), 0);
});

test("parses and validates workspace manifests", () => {
  const manifest = parseWorkspaceManifest('```vetro-workspace\n{"summary":"Built the site","files":[{"path":"src/index.html","content":"<h1>Hello</h1>"}]}\n```');
  assert.deepEqual(manifest, {
    summary: "Built the site",
    files: [{ path: "src/index.html", content: "<h1>Hello</h1>" }],
  });
  assert.match(formatWorkspaceCompletion(manifest, ["src/index.html"]), /written successfully/);
});

test("rejects paths that escape the selected workspace", () => {
  assert.throws(() => normalizeWorkspacePath("../secret.txt"), /Unsafe workspace path/);
  assert.throws(() => normalizeWorkspacePath("/absolute.txt"), /Unsafe workspace path/);
});
