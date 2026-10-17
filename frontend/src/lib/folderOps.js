// Folder tools for VetroAI Computer: work on the files in a folder the user
// opened (File System Access API) — sort them into folders, rename photos by
// the date they were taken, gather duplicates, or any reorganisation the
// user describes. Nothing touches a file until the user has seen the plan:
// every change is a move or rename from one path to another, checked here
// first, applied one by one, and recorded so all of it can be undone.
//
// Files are never deleted or overwritten by a plan.

export const MAX_PLAN_OPS = 2000;

export const CATEGORIES = [
  ["Images", /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|svg|raw|cr2|nef|arw|dng)$/i],
  ["Videos", /\.(mp4|mov|avi|mkv|webm|m4v|3gp|wmv|flv)$/i],
  ["Audio", /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|amr)$/i],
  ["Documents", /\.(pdf|docx?|odt|rtf|txt|md|pages|epub)$/i],
  ["Spreadsheets", /\.(xlsx?|ods|csv|numbers|tsv)$/i],
  ["Presentations", /\.(pptx?|odp|key)$/i],
  ["Archives", /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i],
  ["Installers", /\.(exe|msi|dmg|pkg|apk|deb|rpm|appimage)$/i],
  ["Code", /\.(js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|html|css|json|xml|ya?ml|sh|sql|ipynb)$/i],
];

export const categoryOf = (name) => CATEGORIES.find(([, re]) => re.test(name))?.[0] || "Other";
export const isImage = (name) => /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|dng)$/i.test(name);

export const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);
export function splitName(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

const pad = (n) => String(n).padStart(2, "0");
/** "2024-03-15 14.22.07" — sorts by time, and is valid on every file system. */
export function formatStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/**
 * When a JPEG photo was taken (EXIF DateTimeOriginal, else DateTime), or null.
 * Reads only the start of the file's bytes.
 */
export function exifDate(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      return readTiffDate(view, offset + 10, Math.min(view.byteLength, offset + 2 + size));
    }
    if ((marker & 0xff00) !== 0xff00 || size < 2) return null;
    offset += 2 + size;
  }
  return null;
}

function readTiffDate(view, tiff, end) {
  if (tiff + 8 > end) return null;
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);
  const ascii = (o, n) => {
    let s = "";
    for (let i = 0; i < n && o + i < end; i++) {
      const c = view.getUint8(o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const tags = (ifd) => {
    const out = {};
    if (ifd + 2 > end) return out;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) break;
      out[u16(entry)] = { count: u32(entry + 4), value: u32(entry + 8) };
    }
    return out;
  };
  const ifd0 = tags(tiff + u32(tiff + 4));
  const exif = ifd0[0x8769] ? tags(tiff + ifd0[0x8769].value) : {};
  const tag = exif[0x9003] || exif[0x9004] || ifd0[0x0132];
  if (!tag) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(tiff + tag.value, Math.min(tag.count, 32)));
  if (!m || m[1] === "0000") return null;
  const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── Plans ────────────────────────────────────────────────────────────────────
// A plan is a list of { from, to, why? } paths relative to the folder.

/** Each file into a folder for its kind: Images/, Documents/, Videos/… */
export function planOrganizeByType(entries) {
  return entries
    // Loose files at the top of the folder; folders the user already made are left alone.
    .filter((e) => !e.path.includes("/") && !e.path.startsWith("."))
    .map((e) => ({ from: e.path, to: joinPath(categoryOf(e.name), e.name), why: categoryOf(e.name) }));
}

/** Photos renamed to when they were taken, in the folder they are already in. */
export function planRenameByDate(entries) {
  return entries
    .filter((e) => isImage(e.name) && e.date)
    .map((e) => {
      const { ext } = splitName(e.name);
      return { from: e.path, to: joinPath(dirOf(e.path), `${formatStamp(e.date)}${ext.toLowerCase()}`), why: e.dateSource === "exif" ? "Date taken" : "Date modified" };
    })
    .filter((op) => op.from !== op.to);
}

/** Files with identical contents (same size and hash), largest groups first. */
export function groupDuplicates(entries) {
  const byHash = new Map();
  for (const e of entries) {
    if (!e.hash) continue;
    const key = `${e.size}:${e.hash}`;
    byHash.set(key, [...(byHash.get(key) || []), e]);
  }
  return [...byHash.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.length - b.path.length || a.path.localeCompare(b.path)))
    .sort((a, b) => b.length * b[0].size - a.length * a[0].size);
}

/** Keeps the first copy of each group where it is; the rest go to Duplicates/. */
export function planDuplicates(groups) {
  return groups.flatMap((group) => group.slice(1).map((e) => ({
    from: e.path,
    to: joinPath("Duplicates", e.path.replace(/\//g, " - ")),
    why: `Same as ${group[0].path}`,
  })));
}

/** Gives a target that is already taken a " (2)", " (3)"… suffix. */
function freeName(path, taken) {
  if (!taken.has(path.toLowerCase())) return path;
  const { stem, ext } = splitName(baseOf(path));
  for (let n = 2; ; n++) {
    const candidate = joinPath(dirOf(path), `${stem} (${n})${ext}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const BAD_CHARS = /[<>:"|?*]/;
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 32);
export function cleanPath(path) {
  if (typeof path !== "string") return null;
  const p = path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (!p || p.startsWith("/") || p.length > 400) return null;
  const parts = p.split("/");
  if (parts.some((s) => !s.trim() || s === "." || s === ".." || BAD_CHARS.test(s) || hasControl(s) || s.length > 200 || /[. ]$/.test(s))) return null;
  return p;
}

/**
 * Only changes that are safe to make: the file exists, the target is a new
 * path inside the folder, nothing is overwritten, no two files go to the same
 * place. A clashing target gets a " (2)" suffix rather than being dropped.
 */
export function validatePlan(ops, entries) {
  const existing = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
  const taken = new Set(existing.keys());
  const moving = new Set();
  const valid = [];
  const skipped = [];
  for (const raw of (Array.isArray(ops) ? ops : []).slice(0, MAX_PLAN_OPS)) {
    const from = cleanPath(raw?.from);
    let to = cleanPath(raw?.to);
    if (!from || !existing.has(from.toLowerCase())) { skipped.push({ op: raw, reason: "That file isn't in the folder" }); continue; }
    if (!to) { skipped.push({ op: raw, reason: "Not a valid file name" }); continue; }
    if (moving.has(from.toLowerCase())) { skipped.push({ op: raw, reason: "Already moved by an earlier change" }); continue; }
    if (from === to) continue;
    // Renaming only the letter case is the same file on Windows and macOS.
    if (from.toLowerCase() === to.toLowerCase()) { skipped.push({ op: raw, reason: "Only the capital letters change" }); continue; }
    to = freeName(to, taken);
    taken.add(to.toLowerCase());
    moving.add(from.toLowerCase());
    valid.push({ from: existing.get(from.toLowerCase()).path, to, ...(raw.why ? { why: String(raw.why).slice(0, 120) } : {}) });
  }
  return { ops: valid, skipped };
}

/** The model's plan: JSON with "operations" (or a bare array), inside or outside a code block. */
export function parseAiPlan(text) {
  const src = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src)?.[1];
  const candidates = [fenced, src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1), src.slice(src.indexOf("["), src.lastIndexOf("]") + 1)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      const ops = Array.isArray(data) ? data : data.operations || data.ops || data.changes;
      if (Array.isArray(ops)) return { summary: typeof data.summary === "string" ? data.summary : "", ops };
    } catch { /* try the next shape */ }
  }
  return { summary: "", ops: [] };
}

/** One line per file for the model: path, size, date modified. */
export function manifest(entries, limit = 1500) {
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const lines = entries.slice(0, limit).map((e) => `${e.path} | ${kb(e.size || 0)} | ${e.lastModified ? new Date(e.lastModified).toISOString().slice(0, 10) : "?"}`);
  if (entries.length > limit) lines.push(`… and ${entries.length - limit} more files`);
  return lines.join("\n");
}

export const AI_PLAN_INSTRUCTIONS = [
  "You reorganise files in a folder the user opened. You can only move or rename files: no deleting, no editing contents.",
  "Reply with ONLY a JSON object, no prose before or after:",
  '{"summary": "one sentence on what the plan does", "operations": [{"from": "exact/current/path.ext", "to": "new/path.ext", "why": "short reason"}]}',
  "Rules: use the exact paths from the list; paths are relative to the folder, with / between folders; keep every file's extension;",
  "never send two files to the same path; leave files that are already where they should be out of the list;",
  "use clear, human folder and file names; at most 1000 operations. If nothing needs to change, return an empty operations list and say why in summary.",
].join(" ");

// ── Applying a plan ──────────────────────────────────────────────────────────

async function dirHandle(root, path, create) {
  let dir = root;
  for (const part of path ? path.split("/") : []) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function exists(root, path) {
  try {
    const dir = await dirHandle(root, dirOf(path), false);
    await dir.getFileHandle(baseOf(path));
    return true;
  } catch {
    try {
      const dir = await dirHandle(root, dirOf(path), false);
      await dir.getDirectoryHandle(baseOf(path));
      return true;
    } catch {
      return false;
    }
  }
}

/** Folders along `path` that don't exist yet, outermost first. */
async function missingDirs(root, path) {
  const missing = [];
  let dir = root;
  const parts = path ? path.split("/") : [];
  for (let i = 0; i < parts.length; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch {
      for (let j = i; j < parts.length; j++) missing.push(parts.slice(0, j + 1).join("/"));
      break;
    }
  }
  return missing;
}

async function moveFile(root, from, to) {
  if (await exists(root, to)) throw new Error(`${to} already exists`);
  const srcDir = await dirHandle(root, dirOf(from), false);
  const src = await srcDir.getFileHandle(baseOf(from));
  const destDir = await dirHandle(root, dirOf(to), true);
  if (typeof src.move === "function") {
    try {
      await src.move(destDir, baseOf(to));
      return;
    } catch (err) {
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") throw err;
      /* not supported here: copy, then remove the original */
    }
  }
  const file = await src.getFile();
  const copy = await destDir.getFileHandle(baseOf(to), { create: true });
  const writable = await copy.createWritable();
  await writable.write(file);
  await writable.close();
  await srcDir.removeEntry(baseOf(from));
}

/**
 * Applies the changes one by one. A change that fails is reported and the
 * rest carry on. Returns what was done (to undo later), what failed, and the
 * folders it had to create.
 */
export async function applyPlan(root, ops, { onProgress, signal } = {}) {
  const done = [];
  const failed = [];
  const createdDirs = [];
  for (let i = 0; i < ops.length; i++) {
    if (signal?.aborted) break;
    const op = ops[i];
    try {
      for (const dir of await missingDirs(root, dirOf(op.to))) createdDirs.push(dir);
      await moveFile(root, op.from, op.to);
      done.push(op);
    } catch (err) {
      failed.push({ ...op, error: err?.message || String(err) });
    }
    onProgress?.(i + 1, ops.length);
  }
  return { done, failed, createdDirs };
}

/** Puts every file back, newest change first, and removes folders the plan made if they are empty. */
export async function undoPlan(root, done, createdDirs = [], opts = {}) {
  const back = [...done].reverse().map((op) => ({ from: op.to, to: op.from }));
  const result = await applyPlan(root, back, opts);
  for (const dir of [...createdDirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
    try {
      const parent = await dirHandle(root, dirOf(dir), false);
      const handle = await parent.getDirectoryHandle(baseOf(dir));
      let empty = true;
      for await (const _ of handle.keys()) { empty = false; break; }
      if (empty) await parent.removeEntry(baseOf(dir));
    } catch { /* already gone, or not empty */ }
  }
  return result;
}

/** SHA-256 of a file, as hex. */
export async function hashFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Writes (or replaces) a file at `path` in the folder — used for reports VetroAI makes. */
export async function writeFile(root, path, blob) {
  const dir = await dirHandle(root, dirOf(path), true);
  const handle = await dir.getFileHandle(baseOf(path), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ── Reading the folder ───────────────────────────────────────────────────────

/** Every file in the folder (hidden files and node_modules skipped), up to `limit`. */
export async function scanFolder(root, { limit = 2000, signal } = {}) {
  const out = [];
  const walk = async (dir, prefix) => {
    for await (const [name, handle] of dir.entries()) {
      if (out.length >= limit || signal?.aborted) return;
      if (name.startsWith(".") || name === "node_modules") continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") await walk(handle, path);
      else {
        const file = await handle.getFile();
        out.push({ name, path, size: file.size, type: file.type, lastModified: file.lastModified, handle });
      }
    }
  };
  await walk(root, "");
  return out;
}

export const SUMMARY_COLUMNS = ["File", "Title", "Type", "Date", "From", "Amount", "Summary"];

export const SUMMARY_INSTRUCTIONS = [
  "You summarise documents from a folder into one row each for a spreadsheet.",
  "Reply with ONLY a JSON array, one object per document, in the order given:",
  '[{"file": "exact file path", "title": "short title", "type": "invoice | receipt | bill | letter | report | resume | contract | notes | statement | other", "date": "YYYY-MM-DD or empty", "from": "person or organisation it is from, or empty", "amount": "total with currency, or empty", "summary": "one plain sentence, at most 25 words"}]',
  "Use only what the text says; leave a field empty rather than guess.",
].join(" ");

/** The model's rows, matched back to the files that were sent (in order). */
export function parseSummaryRows(text, paths) {
  const src = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src)?.[1];
  let rows = [];
  for (const candidate of [fenced, src.slice(src.indexOf("["), src.lastIndexOf("]") + 1)].filter(Boolean)) {
    try { const data = JSON.parse(candidate); if (Array.isArray(data)) { rows = data; break; } } catch { /* next */ }
  }
  const byPath = new Map(rows.filter((r) => r && typeof r === "object").map((r) => [String(r.file || ""), r]));
  return paths.map((path, i) => {
    const r = byPath.get(path) || rows[i] || {};
    const cell = (v) => (v == null ? "" : String(v).slice(0, 400));
    return [path, cell(r.title), cell(r.type), cell(r.date), cell(r.from), cell(r.amount), cell(r.summary)];
  });
}
