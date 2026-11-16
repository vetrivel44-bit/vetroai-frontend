const test = require("node:test");
const assert = require("node:assert/strict");

const { findPhotos, imageSubject, searchWikipedia } = require("../src/services/photoSearch");

test("the subject is what the person wants to see, without the asking", () => {
  assert.equal(imageSubject("show me some photos of Ooty lake"), "Ooty lake");
  assert.equal(imageSubject("can you show me some pictures of tigers"), "tigers");
  assert.equal(imageSubject("what does a quokka look like?"), "a quokka");
  assert.equal(imageSubject("who is Sachin Tendulkar"), "Sachin Tendulkar");
  assert.equal(imageSubject("Ooty photos"), "Ooty");
  assert.equal(imageSubject("Taj Mahal"), "Taj Mahal");
});

const img = (name) => `https://img.test/${name}.jpg`;

test("without Tavily, the gallery still fills from Wikipedia, Pexels and Commons", async () => {
  const asked = {};
  const photos = await findPhotos("show me photos of Ooty", {
    tavilyImages: async () => { throw new Error("no Tavily key"); },
    sources: {
      wikipedia: async (s) => { asked.wikipedia = s; return [{ url: img("wiki-ooty"), caption: "Ooty" }, { url: img("wiki-lake"), caption: "Ooty Lake" }, { url: img("wiki-3"), caption: "x" }]; },
      pexels: async (s) => { asked.pexels = s; return [img("pexels-1"), img("wiki-ooty")]; },
      commons: async () => [img("commons-1"), img("commons-2")],
      openverse: async () => { throw new Error("should not be needed"); },
    },
  });
  assert.equal(asked.wikipedia, "Ooty");
  assert.equal(asked.pexels, "ooty");
  assert.deepEqual(photos.map((p) => p.url), [img("wiki-ooty"), img("wiki-lake"), img("pexels-1"), img("commons-1")], "Wikipedia's two first, no repeats");
  assert.equal(photos[0].caption, "Ooty");
  assert.equal(photos[2].caption, "Ooty", "stock photos are captioned with the subject");
});

test("Tavily's images come first when it has some", async () => {
  const photos = await findPhotos("pictures of Chennai beach", {
    limit: 3,
    tavilyImages: async () => [{ url: img("tavily-1"), caption: "Marina Beach" }],
    sources: { wikipedia: async () => [{ url: img("wiki"), caption: "Marina Beach" }], pexels: async () => [], commons: async () => [img("c")] },
  });
  assert.deepEqual(photos.map((p) => p.url), [img("tavily-1"), img("wiki"), img("c")]);
});

test("Openverse is asked only when the others found too few, and failures are skipped", async () => {
  let openverseAsked = false;
  const photos = await findPhotos("show me photos of a rare beetle", {
    tavilyImages: async () => [],
    sources: {
      wikipedia: async () => { throw new Error("down"); },
      pexels: async () => [],
      commons: async () => [],
      openverse: async () => { openverseAsked = true; return [img("ov-1"), "http://insecure.test/x.jpg"]; },
    },
  });
  assert.equal(openverseAsked, true);
  assert.deepEqual(photos.map((p) => p.url), [img("ov-1")], "only https pictures");
});

test("Wikipedia gives each article's lead photo, never a logo drawing", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /en\.wikipedia\.org\/w\/api\.php/);
    assert.match(String(url), /gsrsearch=Taj\+Mahal/);
    return { ok: true, json: async () => ({ query: { pages: {
      2: { index: 2, title: "Agra", thumbnail: { source: "https://upload.wikimedia.org/agra.jpg" } },
      1: { index: 1, title: "Taj Mahal", thumbnail: { source: "https://upload.wikimedia.org/taj.jpg" } },
      3: { index: 3, title: "Logo", thumbnail: { source: "https://upload.wikimedia.org/logo.svg.png" } },
    } } }) };
  };
  assert.deepEqual(await searchWikipedia("Taj Mahal", { fetchImpl }), [
    { url: "https://upload.wikimedia.org/taj.jpg", caption: "Taj Mahal" },
    { url: "https://upload.wikimedia.org/agra.jpg", caption: "Agra" },
  ]);
});
