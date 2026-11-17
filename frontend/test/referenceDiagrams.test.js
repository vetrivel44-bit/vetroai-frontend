import { test } from "node:test";
import assert from "node:assert/strict";
import { findReferenceDiagrams, rankDiagrams, searchUrl, subjectWords } from "../src/lib/referenceDiagrams.js";

const page = (title, mime = "image/svg+xml", extra = {}) => ({
  title: `File:${title}`,
  imageinfo: [{ mime, width: 800, height: 700, url: `https://upload.wikimedia.org/x/${title}`, thumburl: `https://upload.wikimedia.org/thumb/${title}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}`, extmetadata: { LicenseShortName: { value: "CC BY-SA 3.0" }, Artist: { value: '<a href="x">Jane Doe</a>' }, ImageDescription: { value: extra.desc || "" } }, ...extra.info }],
});

test("the subject's words, without the request around them", () => {
  assert.deepEqual(subjectWords("Neat labelled diagram of the human heart"), ["human", "heart"]);
  assert.deepEqual(subjectWords("Structure of a plant cell"), ["plant", "cell"]);
  assert.deepEqual(subjectWords("The eye"), ["eye"]);
  const url = new URL(searchUrl("human heart"));
  assert.equal(url.searchParams.get("origin"), "*", "allowed from the browser");
  assert.equal(url.searchParams.get("gsrsearch"), "human heart diagram");
});

test("English-labelled drawn diagrams of the subject first; others left out", () => {
  const ranked = rankDiagrams("human heart", [
    page("Heart diagram-fa.svg", "image/svg+xml", { desc: "A labelled diagram of the human heart" }),
    page("Human heart photo.jpg", "image/jpeg"),
    page("Heart diagram-en.svg", "image/svg+xml", { desc: "A labelled diagram of the human heart" }),
    page("Diagram of the human heart (cropped).svg"),
    page("Heart icon.svg"),
    page("Lung diagram.svg", "image/svg+xml", { desc: "human lungs" }),
    page("Heart anatomy tiny.png", "image/png", { info: { width: 120, height: 100 } }),
  ]);
  assert.deepEqual(ranked.map((r) => r.title), ["Heart diagram-en", "Diagram of the human heart (cropped)"]);
  assert.equal(ranked[0].author, "Jane Doe", "credited, without the HTML");
  assert.equal(ranked[0].license, "CC BY-SA 3.0");
});

test("nothing confident means nothing shown", () => {
  assert.deepEqual(rankDiagrams("bicycle gear", [page("Gear icon.svg"), page("Bicycle photo.jpg", "image/jpeg")]), []);
  assert.deepEqual(rankDiagrams("", [page("Heart diagram-en.svg")]), []);
});

test("the search runs once per subject and its failure is quiet to retry", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ query: { pages: { 1: { ...page("Volcano diagram-en.svg"), index: 1 } } } }) }; };
  const a = await findReferenceDiagrams("volcano", fetcher);
  const b = await findReferenceDiagrams("Labelled diagram of a volcano", fetcher);
  assert.equal(a[0].title, "Volcano diagram-en");
  assert.equal(b, a);
  assert.equal(calls, 1);
  await assert.rejects(findReferenceDiagrams("glacier", async () => ({ ok: false, status: 429 })));
  const again = await findReferenceDiagrams("glacier", async () => ({ ok: true, json: async () => ({}) }));
  assert.deepEqual(again, [], "a failed search isn't remembered");
});
