import test from "node:test";
import assert from "node:assert/strict";

import { resolveSiteImages } from "../src/lib/siteImages.js";

const API = "https://api.example.com/api";

test("points the prompt's image placeholder at the backend", () => {
  const html = '<img src="https://vetroai-image.invalid/?q=white+leather+sneakers&w=800&h=800" alt="x">';
  assert.equal(
    resolveSiteImages(html, API),
    '<img src="https://api.example.com/api/site-image?q=white+leather+sneakers&w=800&h=800" alt="x">'
  );
});

test("replaces random picsum photos with the subject from the alt text", () => {
  const html = '<title>Stride Shoes</title><img alt="Black running shoes" src="https://picsum.photos/seed/3/800/600">';
  const out = resolveSiteImages(html, API);
  assert.match(out, /src="https:\/\/api\.example\.com\/api\/site-image\?q=Black\+running\+shoes&w=800&h=600&i=1"/);
  assert.doesNotMatch(out, /picsum/);
});

test("CSS backgrounds from random hosts use the page title", () => {
  const html = "<title>Golden Crust Bakery</title><style>.hero{background:url('https://picsum.photos/1600/900')}</style>";
  const out = resolveSiteImages(html, API);
  assert.match(out, /url\('https:\/\/api\.example\.com\/api\/site-image\?q=Golden\+Crust\+Bakery&w=1600&h=900&i=1'\)/);
});

test("leaves real image URLs alone", () => {
  const html = '<img src="https://cdn.shop.com/a.jpg" alt="a">';
  assert.equal(resolveSiteImages(html, API), html);
});
