import { test } from "node:test";
import assert from "node:assert/strict";
import { trimSessionsForCache, MAX_CACHED_DATA_URL } from "../src/lib/chatCache.js";

const big = "data:image/png;base64," + "A".repeat(MAX_CACHED_DATA_URL + 10);
const small = "data:image/jpeg;base64,BBBB";

test("big previews are replaced by their thumbnail", () => {
  const list = [{ id: "1", messages: [{ role: "user", content: "hi", files: [{ name: "a.png", size: 9, preview: big, thumb: small }] }] }];
  const [s] = trimSessionsForCache(list);
  assert.equal(s.messages[0].files[0].preview, small);
  assert.equal(JSON.stringify(s).includes("AAAA"), false);
  // The original (in-memory) list is untouched.
  assert.equal(list[0].messages[0].files[0].preview, big);
});

test("big previews without a thumbnail are dropped, small ones kept", () => {
  const list = [{ id: "1", messages: [{ role: "user", files: [{ name: "a", preview: big }, { name: "b", preview: small }] }] }];
  const files = trimSessionsForCache(list)[0].messages[0].files;
  assert.equal(files[0].preview, null);
  assert.equal(files[1].preview, small);
});

test("big generated images are dropped, URLs kept, unchanged sessions reused", () => {
  const plain = { id: "2", messages: [{ role: "assistant", generatedImageUrl: "https://x/y.png" }] };
  const list = [{ id: "1", messages: [{ role: "assistant", isImageGen: true, generatedImageUrl: big }] }, plain];
  const out = trimSessionsForCache(list);
  assert.equal(out[0].messages[0].generatedImageUrl, null);
  assert.equal(out[1], plain);
});
