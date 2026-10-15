import test from "node:test";
import assert from "node:assert/strict";

import { partialHtml, buildStage, buildSteps, analyzeSite, sectionsOf } from "../src/lib/siteBuild.js";

test("no code yet: understanding, then choosing the design", () => {
  assert.equal(buildStage("").stage, "brief");
  assert.equal(buildStage("Here is a modern sneaker store.").stage, "design");
  assert.equal(partialHtml("Here is a site."), null);
});

test("tracks styling, sections and scripts as the HTML streams", () => {
  const head = "Caption\n```html\n<!doctype html><html><head><style>\n:root{--a:1}\n.btn{color:red}\n";
  const style = buildStage(head);
  assert.equal(style.stage, "style");
  assert.equal(style.detail, "2 CSS rules so far");

  const body = head + "</style></head><body><header class=\"site-header\"></header><section id=\"products-grid\">";
  const sections = buildStage(body);
  assert.equal(sections.stage, "sections");
  assert.equal(sections.detail, "Adding the products grid section");
  assert.deepEqual(sections.sections.map((s) => s.name), ["Site header", "Products grid"]);

  assert.equal(buildStage(body + "</section><script>const cart = [];").stage, "script");
  assert.equal(buildStage(body + "</section></body></html>\n```\nDone").stage, "review");
});

test("step statuses follow the stage", () => {
  const steps = buildSteps("x\n```html\n<html><head><style>a{}");
  assert.deepEqual(steps.map((s) => s.status), ["done", "done", "active", "pending", "pending", "pending"]);
  assert.ok(buildSteps("```html\n<p></p>\n```", { finished: true }).every((s) => s.status === "done"));
});

test("summarizes the finished page", () => {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>@media (max-width: 768px){.grid{display:block}}</style></head>
<body><header><button class="menu-toggle" aria-expanded="false"></button></header><section id="hero" style="background:url('https://x/y.jpg')"></section>
<section class="products"><img src="a"><img src="b"></section><footer></footer><script>document.querySelector('.menu-toggle')</script></body></html>`;
  const info = analyzeSite(html);
  assert.equal(info.images, 3);
  assert.equal(info.responsive, true);
  assert.equal(info.mobileMenu, true);
  assert.equal(info.interactive, true);
  assert.deepEqual(sectionsOf(html).map((s) => s.name), ["Header", "Hero", "Products", "Footer"]);
});
