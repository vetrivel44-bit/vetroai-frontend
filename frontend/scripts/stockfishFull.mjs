// Chess Arena's Master level plays the full Stockfish 19 build from the pinned
// `stockfish` npm package (stockfish.js 19.0.1, GPL-3.0). Its .wasm is about
// 94.5 MiB and Cloudflare serves no file over 25 MiB, so this copies each
// build's loader into public/stockfish/full/ and cuts its .wasm into parts of
// at most PART_SIZE bytes. src/utils/stockfishFull.js downloads the parts,
// caches them and joins them back into one .wasm in the browser.
//
// Part names carry the .wasm's content hash, so a newer engine never mixes
// with cached parts of an older one. Runs before `npm run dev` and
// `npm run build`; the output is generated, not committed (two full builds
// would add about 190 MB to the git history), see .gitignore.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const PART_SIZE = 24 * 1024 * 1024;

// [offset, size] of each part of a `total`-byte file.
export function partRanges(total, partSize = PART_SIZE) {
  const ranges = [];
  for (let offset = 0; offset < total; offset += partSize) ranges.push([offset, Math.min(partSize, total - offset)]);
  return ranges;
}

// The builds Master can use, by loader name: the multi-threaded one needs a
// cross-origin isolated page (Chess Arena's own, /chess), the other runs
// anywhere.
const BUILDS = [
  { name: "stockfish-19", threads: true },
  { name: "stockfish-19-single", threads: false },
];

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(frontend, "public", "stockfish", "full");
const partsDir = path.join(outDir, "parts");
const manifestPath = path.join(outDir, "manifest.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const sameFile = (file, buf) => fs.statSync(file, { throwIfNoEntry: false })?.size === buf.length && sha256(fs.readFileSync(file)) === sha256(buf);

function prepare() {
  const pkgJson = createRequire(import.meta.url).resolve("stockfish/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  const binDir = path.join(path.dirname(pkgJson), "bin");
  const previous = readJson(manifestPath);
  const manifest = { package: `stockfish@${pkg.version}`, partSize: PART_SIZE, builds: {} };
  fs.mkdirSync(partsDir, { recursive: true });

  for (const { name, threads } of BUILDS) {
    const wasm = fs.readFileSync(path.join(binDir, `${name}.wasm`));
    const loader = fs.readFileSync(path.join(binDir, `${name}.js`));
    const hash = sha256(wasm);
    const parts = partRanges(wasm.length).map(([offset, size], i) => ({ file: `${name}-${hash.slice(0, 12)}-${i}.bin`, offset, size }));
    const upToDate = previous?.builds?.[name]?.sha256 === hash
      && parts.every((p) => fs.statSync(path.join(partsDir, p.file), { throwIfNoEntry: false })?.size === p.size);
    if (!upToDate) {
      for (const p of parts) fs.writeFileSync(path.join(partsDir, p.file), wasm.subarray(p.offset, p.offset + p.size));
    }
    const loaderPath = path.join(outDir, `${name}.js`);
    if (!sameFile(loaderPath, loader)) fs.writeFileSync(loaderPath, loader);
    manifest.builds[name] = {
      script: `${name}.js`,
      threads,
      size: wasm.length,
      sha256: hash,
      parts: parts.map(({ file, size }) => ({ file, size })),
    };
    console.log(`stockfish: ${name}.wasm (${(wasm.length / 1048576).toFixed(1)} MiB) → ${parts.length} parts${upToDate ? ", up to date" : ""}`);
  }

  // Parts and loaders of builds that are no longer listed.
  const keep = new Set(Object.values(manifest.builds).flatMap((b) => b.parts.map((p) => p.file)));
  for (const file of fs.readdirSync(partsDir)) if (!keep.has(file)) fs.rmSync(path.join(partsDir, file));
  const scripts = new Set(Object.values(manifest.builds).map((b) => b.script));
  for (const file of fs.readdirSync(outDir)) {
    if (file.endsWith(".js") && !scripts.has(file)) fs.rmSync(path.join(outDir, file));
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepare();
