import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { GROUNDING_RULE, searchQueryFor, isLikelyImageUrl } from "../src/lib/searchGrounding.js";

const require = createRequire(import.meta.url);
const backend = require("../../backend/src/services/searchGrounding.js");

test("the app and the backend share the grounding rule and follow-up queries", () => {
  assert.equal(GROUNDING_RULE, backend.GROUNDING_RULE);
  const history = [{ role: "user", content: "who is the cm of tn" }];
  for (const q of ["then cm of tn in 2025 ?", "what about his party", "tell about gemini argon", "explain photosynthesis"]) {
    assert.equal(searchQueryFor(q, history), backend.searchQueryFor(q, history), q);
  }
});

test("only real image links make it into a gallery", () => {
  for (const url of [
    "https://images.example.com/vijay.jpg",
    "https://cdn.example.com/photo.webp?w=800",
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Vijay.png",
    "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    "data:image/svg+xml;base64,PHN2Zy8+",
  ]) assert.equal(isLikelyImageUrl(url), true, url);

  for (const url of [
    "https://www.facebook.com/deccanherald/posts/tamil-nadu-cabinet/1473306848171041",
    "https://en.wikipedia.org/wiki/C._Joseph_Vijay",
    "https://www.studyiq.com/articles/chief-ministers-of-tamilnadu.html",
    "https://bernama.com/en/news.php?id=2556082",
    "javascript:alert(1)",
    "",
  ]) assert.equal(isLikelyImageUrl(url), false, url);
});
