const WORKSPACE_ACTION = /\b(?:build|create|develop|edit|fix|implement|make|modify|organize|refactor|rename|scaffold|update|write)\b/i;
const WORKSPACE_TARGET = /\b(?:app|application|code|codebase|component|css|directory|file|files|folder|html|javascript|page|project|repository|repo|site|source|typescript|ui|website)\b/i;
const INTERNAL_PROVIDER_STATUS = /\b(?:re-?routing|routing|consulting|provider|model failover|agnes|mistral|gemini|sambanova|openai|groq)\b/i;
const WORKSPACE_MANIFEST = /```vetro-workspace\s*([\s\S]*?)```/i;
const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  ".git", ".next", ".cache", ".turbo", "build", "coverage", "dist", "node_modules", "vendor",
]);

export function requiresWorkspace(prompt = "") {
  return WORKSPACE_ACTION.test(prompt) && WORKSPACE_TARGET.test(prompt);
}

export function shouldIgnoreWorkspaceDirectory(name = "") {
  return IGNORED_WORKSPACE_DIRECTORIES.has(String(name).toLowerCase());
}

export function availableWorkspaceContextSlots(attachedCount = 0, uploadLimit = 10) {
  const count = Number.isFinite(Number(attachedCount)) ? Math.max(0, Number(attachedCount)) : 0;
  return Math.max(0, uploadLimit - count);
}

export function sanitizeProgressStatus(status = "") {
  const value = String(status).trim();
  if (!value) return "";
  if (INTERNAL_PROVIDER_STATUS.test(value)) return "Processing with an available model…";
  return value.slice(0, 120);
}

export function normalizeWorkspacePath(value = "") {
  const path = String(value).trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || path.startsWith("/") || parts.some(part => part === "." || part === "..")) {
    throw new Error(`Unsafe workspace path: ${value || "(empty)"}`);
  }
  return parts.join("/");
}

export function parseWorkspaceManifest(content = "") {
  const match = String(content).match(WORKSPACE_MANIFEST);
  if (!match) return null;

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("The generated workspace change set was not valid JSON.");
  }

  if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("The generated workspace change set did not contain any files.");
  }

  const files = parsed.files.slice(0, 40).map(file => ({
    path: normalizeWorkspacePath(file?.path),
    content: typeof file?.content === "string" ? file.content : "",
  }));
  if (files.some(file => !file.content)) {
    throw new Error("One or more generated workspace files had no content.");
  }

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "Workspace changes prepared.",
    files,
  };
}

export function formatWorkspaceCompletion(manifest, writtenPaths) {
  const paths = writtenPaths || manifest.files.map(file => file.path);
  return [
    manifest.summary,
    "",
    `Created or updated **${paths.length} file${paths.length === 1 ? "" : "s"}** in the connected workspace:`,
    ...paths.map(path => `- \`${path}\``),
    "",
    "The files were written successfully and the workspace was rescanned.",
  ].join("\n");
}
