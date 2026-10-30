// Chess Arena — the full Stockfish 19 build, for Master.
//
// The full build plays with Stockfish's big neural network: about 94.5 MiB of
// WebAssembly, against 1.8 MB for the lite build. Cloudflare serves nothing
// over 25 MiB, so the build is published in parts (scripts/stockfishFull.mjs
// lists them in public/stockfish/full/manifest.json). This downloads the
// parts, keeps them in the Cache API so a returning player downloads nothing,
// and joins them into one Blob.
//
// The stockfish.js loader reads the address of its .wasm from its own URL's
// hash ("stockfish-19-single.js#<url>", falling back to the .wasm next to the
// .js) and loads it with WebAssembly.instantiateStreaming. So the Blob's
// object URL goes in the hash and the engine files stay exactly as published.

const DIR = `${import.meta.env?.BASE_URL ?? "/"}stockfish/full/`;
const CACHE_NAME = "vetroai-stockfish-full";

// ─── status, for the arena's progress line ──────────────────────────────────
// state: idle → downloading → starting → ready, or failed at any point.
// `network` is false while every part so far came from the cache.
let status = { state: "idle", loaded: 0, total: 0, network: false, threads: false, error: null };
const listeners = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const listener of [...listeners]) listener(status);
}

export const getFullEngineStatus = () => status;

export function subscribeFullEngine(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// `details`: { threadCount, hashMb } as the engine was set up.
export function markFullEngineReady(details = {}) {
  setStatus({ state: "ready", error: null, ...details });
}

export function markFullEngineFailed(err) {
  setStatus({ state: "failed", error: err?.message || String(err || "unknown error") });
}

// ─── pieces ─────────────────────────────────────────────────────────────────
// Threads need SharedArrayBuffer, which only a cross-origin isolated page
// has: Chess Arena's own page (/chess, see public/_headers).
export const canUseThreads = () => Boolean(globalThis.crossOriginIsolated) && typeof SharedArrayBuffer !== "undefined";

// The multi-threaded build where threads can run, else the single-threaded one.
export function pickBuild(manifest, threads = canUseThreads()) {
  const builds = Object.values(manifest?.builds || {});
  return (threads && builds.find((b) => b.threads)) || builds.find((b) => !b.threads) || null;
}

const absolute = (url) => new URL(url, globalThis.location?.href).href;
export const partUrl = (file) => absolute(`${DIR}parts/${file}`);

// The loader takes the .wasm address from the first comma-separated field of
// its hash and decodes it with decodeURIComponent.
export const engineWorkerUrl = (script, wasmUrl) => `${DIR}${script}#${encodeURIComponent(wasmUrl)}`;

async function openCache() {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null; // no Cache API here (private window, insecure origin)
  }
}

async function cachedPart(cache, url, size) {
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    const blob = hit && await hit.blob();
    return blob?.size === size ? blob : null;
  } catch {
    return null;
  }
}

async function downloadPart(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("/").pop()}`);
  if (!res.body?.getReader) {
    const blob = await res.blob();
    onBytes(blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(chunks);
}

// The engine downloaded but didn't start: the cached parts may be what is
// wrong, so the next load fetches them again.
export function forgetCachedEngine() {
  try {
    if (typeof caches !== "undefined") caches.delete(CACHE_NAME).catch(() => {});
  } catch { /* no Cache API */ }
}

// Drops cached parts of builds the manifest no longer lists (an engine update).
async function pruneCache(cache, manifest) {
  if (!cache) return;
  try {
    const keep = new Set(Object.values(manifest.builds || {}).flatMap((b) => b.parts.map((p) => partUrl(p.file))));
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  } catch { /* the cache is a convenience */ }
}

async function load() {
  setStatus({ state: "downloading", loaded: 0, total: 0, network: false, error: null });
  const res = await fetch(`${DIR}manifest.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`engine manifest missing (HTTP ${res.status})`);
  const manifest = await res.json();
  const build = pickBuild(manifest);
  if (!build) throw new Error("no engine build listed");

  let loaded = 0;
  let shownAt = 0;
  const progress = (bytes, network) => {
    loaded += bytes;
    const now = Date.now();
    if (network && !status.network) setStatus({ network: true });
    if (now - shownAt > 120 || loaded >= build.size) {
      shownAt = now;
      setStatus({ loaded });
    }
  };
  setStatus({ total: build.size, threads: build.threads });

  const cache = await openCache();
  const blobs = await Promise.all(build.parts.map(async (part) => {
    const url = partUrl(part.file);
    const hit = await cachedPart(cache, url, part.size);
    if (hit) {
      progress(part.size, false);
      return hit;
    }
    const blob = await downloadPart(url, (bytes) => progress(bytes, true));
    if (blob.size !== part.size) throw new Error(`${part.file} is ${blob.size} bytes, expected ${part.size}`);
    try { await cache?.put(url, new Response(blob)); } catch { /* full or unavailable: next visit downloads again */ }
    return blob;
  }));
  pruneCache(cache, manifest);

  const wasm = new Blob(blobs, { type: "application/wasm" });
  if (wasm.size !== build.size) throw new Error(`engine is ${wasm.size} bytes, expected ${build.size}`);
  setStatus({ state: "starting", loaded: build.size });
  const wasmUrl = URL.createObjectURL(wasm);
  try {
    return { worker: new Worker(engineWorkerUrl(build.script, wasmUrl)), build, release: () => URL.revokeObjectURL(wasmUrl) };
  } catch (err) {
    URL.revokeObjectURL(wasmUrl);
    throw err;
  }
}

// Resolves to { worker, build, release } — a worker that is loading the full
// engine (call release() once it has answered, to free the joined .wasm) —
// or rejects when the parts can't be had. Once per page.
let loading = null;
export function loadFullEngine() {
  if (!loading) loading = load();
  return loading;
}
