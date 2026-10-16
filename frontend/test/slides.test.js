import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import JSZip from "jszip";

import { SLIDE_H, SLIDE_W, THEMES, buildPptx, deckFileName, fitFontSize, layoutDeck, parseDeck, wantsSlides } from "../src/lib/slides.js";
import { VISUALS_PROMPT } from "../src/lib/visualsPrompt.js";

const PptxGenJS = createRequire(import.meta.url)("pptxgenjs");

const DECK = {
  title: "Solar Energy",
  subtitle: "Growth and economics",
  theme: "sunset",
  slides: [
    { layout: "title", kicker: "Briefing", title: "Solar Energy", subtitle: "Growth and economics", notes: "Welcome." },
    { layout: "stats", title: "Solar is growing fast", stats: [{ value: "100 GW", label: "Installed" }, { value: "₹2.5", label: "Per kWh" }] },
    { layout: "bullets", title: "Why it wins", bullets: ["Cheap modules", { text: "Auctions", sub: ["Reverse bidding"] }], takeaway: "Cheaper than coal." },
    { layout: "chart", title: "Capacity", chart: { type: "bar", labels: ["2022", "2023"], series: [{ name: "GW", values: [63, "73"] }] }, bullets: ["Up 16%"] },
    { layout: "two-column", title: "Utility vs rooftop", left: { heading: "Utility", bullets: ["Cheap"] }, right: { heading: "Rooftop", bullets: ["Local"] } },
    { layout: "process", title: "How it works", steps: [{ title: "Capture", text: "Panels" }, { title: "Convert", text: "Inverters" }] },
    { layout: "table", title: "States", headers: ["State", "GW"], rows: [["Rajasthan", "25"], ["Gujarat"]] },
    { layout: "quote", quote: "Sun for all.", author: "Someone" },
    { layout: "section", title: "Next" },
    { layout: "closing", title: "Thank you", subtitle: "Questions?" },
  ],
};

test("parses every layout and keeps the content", () => {
  const deck = parseDeck(JSON.stringify(DECK));
  assert.equal(deck.title, "Solar Energy");
  assert.equal(deck.themeName, "sunset");
  assert.deepEqual(deck.slides.map((s) => s.layout), DECK.slides.map((s) => s.layout));
  assert.deepEqual(deck.slides[2].bullets, [{ text: "Cheap modules", level: 0 }, { text: "Auctions", level: 0 }, { text: "Reverse bidding", level: 1 }]);
  assert.deepEqual(deck.slides[3].chart.series[0].values, [63, 73]);
  assert.equal(deck.slides[0].notes, "Welcome.");
});

test("guesses a layout from content and falls back when data is missing", () => {
  const deck = parseDeck(JSON.stringify({ slides: [
    { title: "Numbers", stats: [{ value: "5", label: "x" }] },
    { layout: "timeline", title: "Plan", steps: ["Start", "Finish"] },
    { layout: "chart", title: "No data", bullets: ["a"] },
    { layout: "mystery", title: "Plain", bullets: ["b"] },
  ] }));
  assert.deepEqual(deck.slides.map((s) => s.layout), ["stats", "process", "bullets", "bullets"]);
  assert.equal(deck.title, "Numbers");
  assert.equal(deck.themeName, "midnight");
});

test("a reply cut off mid-deck still gives the finished slides", () => {
  const full = JSON.stringify(DECK);
  const cut = full.slice(0, full.indexOf('{"layout":"quote"') + 20);
  const deck = parseDeck(cut);
  assert.equal(deck.slides.length, 7);
  assert.throws(() => parseDeck("not json"));
  assert.throws(() => parseDeck('{"slides":[]}'), /no slides/);
});

test("every shape stays on the slide", () => {
  for (const theme of Object.keys(THEMES)) {
    const pages = layoutDeck(parseDeck(JSON.stringify({ ...DECK, theme })));
    for (const page of pages) {
      for (const sh of page.shapes.filter((s) => s.type !== "ellipse")) {
        assert.ok(sh.x >= 0 && sh.y >= 0, `${sh.type} starts on the slide`);
        assert.ok(sh.x + sh.w <= SLIDE_W + 0.01, `${sh.type} fits the width`);
        if (sh.h) assert.ok(sh.y + sh.h <= SLIDE_H + 0.01, `${sh.type} fits the height`);
      }
    }
  }
});

test("long text shrinks to fit", () => {
  const short = fitFontSize([{ text: "Short" }], 5, 1, 30);
  const long = fitFontSize([{ text: "A much longer line of text that needs to wrap ".repeat(6) }], 5, 1, 30);
  assert.equal(short, 30);
  assert.ok(long < 20);
});

test("builds a real .pptx with charts, tables and speaker notes", async () => {
  const deck = parseDeck(JSON.stringify(DECK));
  const buf = await buildPptx(deck, PptxGenJS).write({ outputType: "nodebuffer" });
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  assert.equal(slides.length, DECK.slides.length);
  assert.ok(Object.keys(zip.files).some((p) => p.startsWith("ppt/charts/")), "native chart");
  assert.match(await zip.file("ppt/slides/slide7.xml").async("string"), /<a:tbl>/);
  assert.match(await zip.file("ppt/notesSlides/notesSlide1.xml").async("string"), /Welcome\./);
  assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /Solar Energy/);
  assert.equal(deckFileName(deck), "Solar Energy.pptx");
  assert.equal(deckFileName({ title: 'a/b: "c"?' }), "ab c.pptx");
});

test("spots presentation requests", () => {
  for (const q of ["make a ppt on AI", "Create a PowerPoint about cells", "10 slides on climate", "presentation for my class"]) assert.ok(wantsSlides(q), q);
  for (const q of ["what is AI?", "slideshow?"]) assert.ok(!wantsSlides(q), q);
});

test("the prompt's example deck is valid", () => {
  const example = VISUALS_PROMPT.match(/```slides\n([\s\S]*?)\n```/)[1];
  const deck = parseDeck(example);
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides.at(-1).layout, "closing");
});
