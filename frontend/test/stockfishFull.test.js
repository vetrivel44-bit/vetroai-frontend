import test from "node:test";
import assert from "node:assert/strict";

import { partRanges, PART_SIZE } from "../scripts/stockfishFull.mjs";
import { pickBuild, engineWorkerUrl } from "../src/utils/stockfishFull.js";

const MiB = 1024 * 1024;

test("the full build's .wasm is cut into parts Cloudflare will serve", () => {
  const total = 99169054; // stockfish-19-single.wasm
  const ranges = partRanges(total);
  assert.equal(ranges.length, 4);
  assert.ok(PART_SIZE < 25 * MiB);
  let next = 0;
  for (const [offset, size] of ranges) {
    assert.equal(offset, next); // contiguous, nothing skipped or repeated
    assert.ok(size > 0 && size <= PART_SIZE);
    next += size;
  }
  assert.equal(next, total);
  assert.deepEqual(partRanges(PART_SIZE), [[0, PART_SIZE]]);
});

test("the worker URL hands the loader the .wasm address it decodes", () => {
  const blobUrl = "blob:https://vetroai-frontend.pages.dev/0f8e2c1a-77b1-4c9e-9a51-3d6c1f0b2e44";
  const url = engineWorkerUrl("stockfish-19-single.js", blobUrl);
  assert.ok(url.startsWith("/stockfish/full/stockfish-19-single.js#"));
  // What stockfish-19-single.js does with its own location.hash:
  const hash = url.slice(url.indexOf("#"));
  const fields = hash.substr(1).split(",");
  assert.equal(decodeURIComponent(fields[0]), blobUrl);
});

test("the single-threaded full build is the one picked", () => {
  const manifest = { builds: {
    "stockfish-19-single": { script: "stockfish-19-single.js", threads: false },
  } };
  assert.equal(pickBuild(manifest).script, "stockfish-19-single.js");
  assert.equal(pickBuild({ builds: {} }), null);
  assert.equal(pickBuild(null), null);
});
