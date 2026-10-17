import test from "node:test";
import assert from "node:assert/strict";

import { siteIdFor, siteIdFromPath, siteUrl, withStorageShim } from "../src/lib/sitePublish.js";

test("a published site gets a readable, unguessable address", () => {
  let n = 0;
  const id = siteIdFor("Sneaker Store — Summer Sale!", () => (n++ % 31) / 31);
  assert.match(id, /^sneaker-store-summer-sale-[a-z2-9]{6}$/);
  assert.match(siteIdFor("", Math.random), /^site-[a-z2-9]{6}$/);
  assert.equal(siteIdFromPath(`/s/${id}`), id);
  assert.equal(siteIdFromPath("/s/../../etc"), null);
  assert.equal(siteIdFromPath("/chat"), null);
  assert.equal(siteUrl("abc-123456", "https://vetroai.app"), "https://vetroai.app/s/abc-123456");
});

test("published pages get working storage inside the sandbox", () => {
  assert.match(withStorageShim("<html><head><title>x</title></head></html>"), /<head><script>/);
  assert.match(withStorageShim("<p>hi</p>"), /^<script>/);
});
