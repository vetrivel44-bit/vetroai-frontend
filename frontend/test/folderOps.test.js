import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPlan, categoryOf, cleanPath, exifDate, formatStamp, groupDuplicates, manifest, parseAiPlan,
  planDuplicates, planOrganizeByType, planRenameByDate, undoPlan, validatePlan, writeFile,
} from "../src/lib/folderOps.js";

// A folder in memory, shaped like the File System Access API's handles.
function memoryFolder(files, { withMove = false } = {}) {
  const makeDir = (name) => {
    const children = new Map();
    const dir = {
      kind: "directory", name, children,
      async getDirectoryHandle(n, { create } = {}) {
        let c = children.get(n);
        if (c?.kind === "file") throw Object.assign(new Error("TypeMismatch"), { name: "TypeMismatchError" });
        if (!c) { if (!create) throw Object.assign(new Error(`${n} not found`), { name: "NotFoundError" }); c = makeDir(n); children.set(n, c); }
        return c;
      },
      async getFileHandle(n, { create } = {}) {
        let c = children.get(n);
        if (c?.kind === "directory") throw Object.assign(new Error("TypeMismatch"), { name: "TypeMismatchError" });
        if (!c) { if (!create) throw Object.assign(new Error(`${n} not found`), { name: "NotFoundError" }); c = makeFile(n, ""); children.set(n, c); }
        return c;
      },
      async removeEntry(n) { if (!children.delete(n)) throw new Error(`${n} not found`); },
      async *keys() { yield* children.keys(); },
    };
    return dir;
  };
  const makeFile = (name, content) => {
    const file = {
      kind: "file", name, content,
      async getFile() { return new Blob([file.content]); },
      async createWritable() {
        let next = "";
        return { async write(data) { next += typeof data === "string" ? data : await data.text(); }, async close() { file.content = next; } };
      },
    };
    if (withMove) {
      file.move = async (destDir, newName) => {
        const parent = findParent(root, file);
        parent.children.delete(file.name);
        file.name = newName;
        destDir.children.set(newName, file);
      };
    }
    return file;
  };
  const findParent = (dir, target) => {
    for (const c of dir.children.values()) {
      if (c === target) return dir;
      if (c.kind === "directory") { const p = findParent(c, target); if (p) return p; }
    }
    if (dir === root) return null;
    return null;
  };
  const root = makeDir("root");
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) { if (!dir.children.has(part)) dir.children.set(part, makeDir(part)); dir = dir.children.get(part); }
    dir.children.set(parts.at(-1), makeFile(parts.at(-1), content));
  }
  const list = (dir = root, prefix = "") => [...dir.children.values()].flatMap((c) => c.kind === "directory" ? list(c, `${prefix}${c.name}/`).concat(c.children.size ? [] : [`${prefix}${c.name}/`]) : [`${prefix}${c.name}`]).sort();
  const read = (path) => { let d = root; const parts = path.split("/"); for (const p of parts.slice(0, -1)) d = d.children.get(p); return d.children.get(parts.at(-1))?.content; };
  return { root, list, read };
}

const entry = (path, extra = {}) => ({ path, name: path.split("/").pop(), size: 10, ...extra });

test("files are sorted into folders by kind; folders the user made are left alone", () => {
  assert.equal(categoryOf("IMG_001.JPG"), "Images");
  assert.equal(categoryOf("report.pdf"), "Documents");
  assert.equal(categoryOf("setup.exe"), "Installers");
  assert.equal(categoryOf("notes"), "Other");
  const ops = planOrganizeByType([entry("a.jpg"), entry("b.pdf"), entry("Trip/c.jpg"), entry(".DS_Store"), entry("song.mp3")]);
  assert.deepEqual(ops.map((o) => [o.from, o.to]), [["a.jpg", "Images/a.jpg"], ["b.pdf", "Documents/b.pdf"], ["song.mp3", "Audio/song.mp3"]]);
});

test("photos are renamed to the date they were taken", () => {
  assert.equal(formatStamp(new Date(2024, 2, 5, 9, 4, 7)), "2024-03-05 09.04.07");
  const ops = planRenameByDate([
    entry("IMG_1.JPG", { date: new Date(2024, 2, 5, 9, 4, 7), dateSource: "exif" }),
    entry("Trip/IMG_2.heic", { date: new Date(2023, 11, 31, 23, 59, 0) }),
    entry("notes.txt", { date: new Date() }),
  ]);
  assert.deepEqual(ops.map((o) => [o.from, o.to, o.why]), [
    ["IMG_1.JPG", "2024-03-05 09.04.07.jpg", "Date taken"],
    ["Trip/IMG_2.heic", "Trip/2023-12-31 23.59.00.heic", "Date modified"],
  ]);
});

test("reads the date a JPEG was taken from its EXIF data", () => {
  // A minimal JPEG: SOI, APP1 "Exif" with a little-endian TIFF holding DateTimeOriginal.
  const date = "2021:07:14 18:30:05\0";
  const tiff = [];
  const u16 = (n) => [n & 255, n >> 8];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
  // Header (8) + IFD0 with 1 entry (2 + 12 + 4) at 8 → ExifIFD at 26 with 1 entry (2+12+4) → string at 44.
  tiff.push(0x49, 0x49, ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(date.length), ...u32(44), ...u32(0));
  tiff.push(...[...date].map((c) => c.charCodeAt(0)));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...[(app1.length + 2) >> 8, (app1.length + 2) & 255], ...app1, 0xff, 0xd9]);
  const taken = exifDate(bytes.buffer);
  assert.equal(formatStamp(taken), "2021-07-14 18.30.05");
  assert.equal(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null, "not a JPEG");
});

test("duplicates: the shallowest copy stays, the others go to Duplicates/", () => {
  const groups = groupDuplicates([
    entry("Backup/old/photo.jpg", { hash: "h1", size: 500 }),
    entry("photo.jpg", { hash: "h1", size: 500 }),
    entry("Copy of photo.jpg", { hash: "h1", size: 500 }),
    entry("unique.txt", { hash: "h2", size: 5 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0].path, "photo.jpg");
  assert.deepEqual(planDuplicates(groups).map((o) => o.to), ["Duplicates/Copy of photo.jpg", "Duplicates/Backup - old - photo.jpg"]);
});

test("a plan is checked before anything is touched", () => {
  const entries = [entry("a.jpg"), entry("b.jpg"), entry("Images/a.jpg"), entry("c.txt")];
  const { ops, skipped } = validatePlan([
    { from: "a.jpg", to: "Images/a.jpg" },          // taken → gets " (2)"
    { from: "b.jpg", to: "../outside.jpg" },        // escapes the folder
    { from: "missing.jpg", to: "x.jpg" },           // not in the folder
    { from: "c.txt", to: "/etc/passwd" },           // absolute
    { from: "a.jpg", to: "again.jpg" },             // already moved
    { from: "b.jpg", to: "Photos\\b.jpg" },         // Windows separator is fine
    { from: "Images/a.jpg", to: "images/A.JPG" },   // case only
  ], entries);
  assert.deepEqual(ops.map((o) => [o.from, o.to]), [["a.jpg", "Images/a (2).jpg"], ["b.jpg", "Photos/b.jpg"]]);
  assert.equal(skipped.length, 5);
  assert.equal(cleanPath("a/../b"), null);
  assert.equal(cleanPath("ok/name.txt"), "ok/name.txt");
  assert.equal(cleanPath("bad:name.txt"), null);
});

test("the model's plan is read from JSON, with or without a code block", () => {
  assert.equal(parseAiPlan('```json\n{"summary":"Sorted","operations":[{"from":"a","to":"b"}]}\n```').ops.length, 1);
  assert.equal(parseAiPlan('Here you go: {"summary":"s","operations":[]} done').summary, "s");
  assert.equal(parseAiPlan('[{"from":"a","to":"b"}]').ops.length, 1);
  assert.deepEqual(parseAiPlan("no json here").ops, []);
  assert.match(manifest([entry("a.jpg", { size: 2048, lastModified: Date.UTC(2024, 0, 2) })]), /^a\.jpg \| 2 KB \| 2024-01-02$/);
});

for (const withMove of [false, true]) {
  test(`changes are applied to the real folder and can all be undone (${withMove ? "move()" : "copy and remove"})`, async () => {
    const folder = memoryFolder({ "a.jpg": "A", "b.pdf": "B", "Images/x.png": "X" }, { withMove });
    const before = folder.list();
    const plan = validatePlan(planOrganizeByType([entry("a.jpg"), entry("b.pdf")]), [entry("a.jpg"), entry("b.pdf"), entry("Images/x.png")]).ops;
    const progress = [];
    const result = await applyPlan(folder.root, plan, { onProgress: (n, total) => progress.push(`${n}/${total}`) });
    assert.equal(result.failed.length, 0);
    assert.deepEqual(folder.list(), ["Documents/b.pdf", "Images/a.jpg", "Images/x.png"]);
    assert.equal(folder.read("Images/a.jpg"), "A", "contents are kept");
    assert.deepEqual(result.createdDirs, ["Documents"]);
    assert.deepEqual(progress, ["1/2", "2/2"]);

    await undoPlan(folder.root, result.done, result.createdDirs);
    assert.deepEqual(folder.list(), before, "everything is back, and the new Documents folder is gone");
  });
}

test("a file is never overwritten, even if one appears after the plan was made", async () => {
  const folder = memoryFolder({ "a.jpg": "mine", "Images/a.jpg": "theirs" });
  const result = await applyPlan(folder.root, [{ from: "a.jpg", to: "Images/a.jpg" }]);
  assert.equal(result.done.length, 0);
  assert.match(result.failed[0].error, /already exists/);
  assert.equal(folder.read("Images/a.jpg"), "theirs");
  assert.equal(folder.read("a.jpg"), "mine");
});

test("a report is written into the folder", async () => {
  const folder = memoryFolder({});
  await writeFile(folder.root, "VetroAI/summary.csv", new Blob(["a,b"]));
  assert.equal(folder.read("VetroAI/summary.csv"), "a,b");
});

test("document summaries become one spreadsheet row per file, in order", async () => {
  const { parseSummaryRows, SUMMARY_COLUMNS } = await import("../src/lib/folderOps.js");
  const rows = parseSummaryRows('```json\n[{"file":"b.pdf","title":"Electricity bill","type":"bill","amount":"₹1,240","summary":"October bill."},{"file":"a.pdf","title":"Offer letter"}]\n```', ["a.pdf", "b.pdf", "c.pdf"]);
  assert.equal(SUMMARY_COLUMNS.length, rows[0].length);
  assert.deepEqual(rows.map((r) => r[1]), ["Offer letter", "Electricity bill", ""]);
  assert.equal(rows[1][5], "₹1,240");
});
