import test from "node:test";
import assert from "node:assert/strict";

import { browserActions, screenshotUrls } from "../src/lib/browserReplay.js";

test("the live browser plays the real searches and pages, in order, once each", () => {
  const research = { steps: [
    { id: "plan", items: [] },
    { id: "search-1", items: ["Ather 450S price 2026", "Ola S1 Pro range"] },
    { id: "read", items: ["autocarindia.com", "www.bikedekho.com", "autocarindia.com"] },
    { id: "search-2", items: ["ather 450s price 2026", "TVS iQube reliability"] },
  ] };
  const sources = [
    { url: "https://www.autocarindia.com/bike-news/ather-450s", title: "Ather 450S review", domain: "autocarindia.com" },
    { url: "https://zigwheels.com/iqube", title: "TVS iQube", domain: "zigwheels.com" },
  ];
  const acts = browserActions({ research, sources });
  assert.deepEqual(acts.map((a) => a.type === "search" ? `S:${a.query}` : `V:${a.domain}`), [
    "S:Ather 450S price 2026", "S:Ola S1 Pro range", "V:autocarindia.com", "V:bikedekho.com", "S:TVS iQube reliability", "V:zigwheels.com",
  ]);
  assert.equal(acts[2].url, "https://www.autocarindia.com/bike-news/ather-450s");
  assert.equal(acts[2].title, "Ather 450S review");
  assert.equal(acts[3].url, "https://bikedekho.com");
});

test("an ordinary web search shows the question, then the pages it used", () => {
  const acts = browserActions({ query: "weather in Salem", sources: [{ url: "https://weather.com/x", title: "Weather" }] });
  assert.deepEqual(acts.map((a) => a.type), ["search", "visit"]);
  assert.equal(acts[1].domain, "weather.com");
  assert.deepEqual(browserActions({}), []);
  assert.match(screenshotUrls("https://a.com")[0], /^https:\/\/image\.thum\.io\/get\/.*https:\/\/a\.com$/);
});
