import { test } from "node:test";
import assert from "node:assert/strict";
import { imageAlt, isImageUrl } from "../src/lib/inlineImages.js";

test("links straight to pictures are recognised; pages about them aren't", () => {
  assert.equal(isImageUrl("https://upload.wikimedia.org/wikipedia/commons/1/1d/Taj_Mahal.jpg"), true);
  assert.equal(isImageUrl("https://example.com/photos/tiger.webp?w=800"), true);
  assert.equal(isImageUrl("https://images.pexels.com/photos/123/pexels-photo-123"), true, "an image host");
  assert.equal(isImageUrl("https://en.wikipedia.org/wiki/Taj_Mahal"), false);
  assert.equal(isImageUrl("https://example.com/gallery/tigers"), false);
  assert.equal(isImageUrl("javascript:alert(1).jpg"), false);
  assert.equal(isImageUrl("not a url"), false);
});

test("the link's words describe the picture, unless they're just a URL or 'Image 1'", () => {
  assert.equal(imageAlt("Taj Mahal at dawn", "https://x.test/a.jpg"), "Taj Mahal at dawn");
  assert.equal(imageAlt("https://x.test/a.jpg", "https://x.test/a.jpg"), "");
  assert.equal(imageAlt("Image 2", "https://x.test/a.jpg"), "");
});
