const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const deals = require("../src/services/dealsService");

test("extractPrices reads the sale price and MRP, skipping EMI amounts", () => {
  assert.deepEqual(
    deals.extractPrices("Apple iPhone 15 (128 GB) ₹61,999 M.R.P: ₹79,900 EMI from ₹3,006/month", "in"),
    { price: 61999, originalPrice: 79900 },
  );
  assert.deepEqual(deals.extractPrices("No cost EMI ₹2,500 per month. Price Rs. 24,990", "in"), { price: 24990, originalPrice: null });
  assert.deepEqual(deals.extractPrices("Sony WH-1000XM5 $328.00 Was $399.99", "us"), { price: 328, originalPrice: 399.99 });
  assert.equal(deals.extractPrices("no price here", "in"), null);
});

test("storeForUrl matches store domains and subdomains only", () => {
  assert.equal(deals.storeForUrl("https://www.amazon.in/dp/B0C", "in").id, "amazon");
  assert.equal(deals.storeForUrl("https://www.flipkart.com/x/p/itm1", "in").id, "flipkart");
  assert.equal(deals.storeForUrl("https://notamazon.in/x", "in"), null);
  assert.equal(deals.storeForUrl("https://www.amazon.com/dp/1", "in"), null);
});

test("cleanTitle strips store suffixes", () => {
  assert.equal(deals.cleanTitle("Buy boAt Airdopes 141 : Amazon.in: Electronics"), "boAt Airdopes 141");
});

test("GET /api/deals/search returns offers sorted cheapest first, with store links and an hourly refresh", async (t) => {
  const saved = { serp: config.serpApiKey, tavily: config.tavilyApiKey };
  config.serpApiKey = "test-key";
  config.tavilyApiKey = "";
  deals._cache.clear();
  const realFetch = global.fetch;
  let serpCalls = 0;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://serpapi.com/")) {
      serpCalls++;
      return Response.json({
        shopping_results: [
          { title: "boAt Airdopes 141", source: "Flipkart", link: "https://www.flipkart.com/boat/p/1", extracted_price: 1099, extracted_old_price: 4490, thumbnail: "https://img/1.jpg", rating: 4.1, reviews: 1200 },
          { title: "boAt Airdopes 141", source: "Amazon.in", link: "https://www.amazon.in/dp/B09", extracted_price: 999, extracted_old_price: 4490, thumbnail: "https://img/2.jpg" },
          { title: "no price", source: "Croma", link: "https://www.croma.com/p/1" },
        ],
      });
    }
    return realFetch(url, opts);
  };
  t.after(() => { global.fetch = realFetch; config.serpApiKey = saved.serp; config.tavilyApiKey = saved.tavily; deals._cache.clear(); deals._tracked.clear(); });

  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await realFetch(`${base}/api/deals/search?q=airdopes&region=in`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.provider, "google-shopping");
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0].store, "Amazon");
  assert.equal(body.data.items[0].price, 999);
  assert.equal(body.data.items[0].discountPct, 78);
  assert.equal(body.data.items[0].url, "https://www.amazon.in/dp/B09");
  assert.ok(body.data.storeLinks.some((s) => s.url === "https://www.amazon.in/s?k=airdopes"));
  assert.equal(body.data.refreshIntervalMs, 60 * 60 * 1000);
  assert.ok(deals._tracked.has("in|airdopes"));

  // Served from the hourly cache the second time.
  const again = await (await realFetch(`${base}/api/deals/search?q=airdopes&region=in`)).json();
  assert.equal(again.data.cached, true);
  assert.equal(serpCalls, 1);

  const missing = await realFetch(`${base}/api/deals/search?q=`);
  assert.equal(missing.status, 400);
});

test("price history keeps the lowest price ever seen across hourly checks", async (t) => {
  const history = require("../src/services/priceHistoryService");
  const saved = { serp: config.serpApiKey, tavily: config.tavilyApiKey };
  config.serpApiKey = "test-key";
  config.tavilyApiKey = "";
  deals._cache.clear();
  history._memory.clear();
  const realFetch = global.fetch;
  const prices = [1499, 1299, 1399];
  let call = 0;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://serpapi.com/")) {
      const price = prices[call++];
      return Response.json({ shopping_results: [{ title: "Noise ColorFit Pro 5", source: "Amazon.in", link: "https://www.amazon.in/dp/N5", extracted_price: price }] });
    }
    if (String(url).startsWith("https://www.amazon.in/")) return new Response("", { status: 503 });
    return realFetch(url, opts);
  };
  t.after(() => { global.fetch = realFetch; config.serpApiKey = saved.serp; config.tavilyApiKey = saved.tavily; deals._cache.clear(); deals._tracked.clear(); history._memory.clear(); });

  const first = await deals.findDeals("noise smartwatch", "in", { force: true });
  assert.equal(first.items[0].history.lowestPrice, 1499);
  assert.equal(first.items[0].history.isLowest, true);

  const second = await deals.findDeals("noise smartwatch", "in", { force: true });
  assert.equal(second.items[0].history.lowestPrice, 1299);
  assert.equal(second.items[0].history.isLowest, true);

  const third = await deals.findDeals("noise smartwatch", "in", { force: true });
  assert.equal(third.items[0].price, 1399);
  assert.equal(third.items[0].history.lowestPrice, 1299);
  assert.equal(third.items[0].history.highestPrice, 1499);
  assert.equal(third.items[0].history.isLowest, false);
  assert.equal(third.items[0].history.aboveLowestBy, 100);
  assert.deepEqual(third.items[0].history.points.map((p) => p.p), [1499, 1299, 1399]);
  assert.equal(third.history.lowestPrice, 1299);

  // The cached answer carries the same history.
  const cached = await deals.findDeals("noise smartwatch", "in");
  assert.equal(cached.cached, true);
  assert.equal(cached.items[0].history.lowestPrice, 1299);
});

const extras = require("../src/services/productExtras");
const { summarize } = require("../src/services/priceHistoryService");
const DAY = 24 * 60 * 60 * 1000;

test("summarize flags a 3–4 month low only with at least 90 days of history", () => {
  const now = Date.UTC(2026, 9, 7);
  const ext = (pairs) => ({ source: "keepa", points: pairs.map(([daysAgo, p]) => ({ p, t: now - daysAgo * DAY })) });

  // 150 days of history, today's 900 beats everything in the last 120 days.
  let h = summarize(null, 900, ext([[150, 850], [100, 1000], [40, 950], [1, 900]]), now);
  assert.equal(h.coveredDays, 150);
  assert.equal(h.isWindowLow, true);
  assert.equal(h.windowLowPrice, 900);
  assert.equal(h.lowestPrice, 850);        // all-time low sits outside the window
  assert.equal(h.source, "keepa");

  // A cheaper price inside the window → not a deal.
  h = summarize(null, 900, ext([[150, 1000], [60, 880], [1, 900]]), now);
  assert.equal(h.isWindowLow, false);
  assert.equal(h.aboveWindowLowBy, 20);

  // Lowest seen, but only 30 days of data → not enough history.
  h = summarize(null, 900, ext([[30, 1000], [1, 900]]), now);
  assert.equal(h.enoughHistory, false);
  assert.equal(h.isWindowLow, false);
  assert.equal(h.isLowest, true);
});

test("Keepa series, ASINs and image helpers", () => {
  // Keepa minutes 7000000 → ms; -1 means no offer; prices in paise.
  const pts = extras.keepaSeries([7000000, 129900, 7000060, -1, 7000120, 119900]);
  assert.deepEqual(pts.map((p) => p.p), [1299, 1199]);
  assert.equal(pts[0].t, (7000000 + 21564000) * 60000);
  assert.equal(extras.asinFromUrl("https://www.amazon.in/Noise-Watch/dp/B0CXYZ1234/ref=sr_1_1?x=1"), "B0CXYZ1234");
  assert.equal(extras.asinFromUrl("https://www.flipkart.com/x/p/itm1"), null);
  assert.equal(
    extras.upgradeImageUrl("https://m.media-amazon.com/images/I/71abcDEF+gL._AC_UY218_.jpg"),
    "https://m.media-amazon.com/images/I/71abcDEF+gL._AC_SL1000_.jpg",
  );
  assert.equal(
    extras.upgradeImageUrl("https://rukminim2.flixcart.com/image/312/312/xif0q/mobile/a.jpeg?q=70"),
    "https://rukminim2.flixcart.com/image/832/832/xif0q/mobile/a.jpeg?q=70",
  );
  assert.equal(
    extras.pickMetaImage('<meta property="og:image" content="https://rukminim2.flixcart.com/image/416/416/a.jpeg">', "https://www.flipkart.com/p"),
    "https://rukminim2.flixcart.com/image/416/416/a.jpeg",
  );
  assert.equal(extras.isAllowedImageUrl("https://m.media-amazon.com/images/I/a.jpg"), true);
  assert.equal(extras.isAllowedImageUrl("https://evil.example/a.jpg"), false);
  assert.equal(extras.isAllowedImageUrl("http://m.media-amazon.com/a.jpg"), false);
  assert.equal(extras.isAllowedImageUrl("https://169.254.169.254/latest"), false);
});

test("Amazon offers get Keepa history and photo; other offers get the page's og:image", async (t) => {
  const history = require("../src/services/priceHistoryService");
  const saved = { serp: config.serpApiKey, tavily: config.tavilyApiKey, keepa: config.keepaApiKey };
  config.serpApiKey = "test-key";
  config.tavilyApiKey = "";
  config.keepaApiKey = "keepa-key";
  deals._cache.clear();
  history._memory.clear();
  extras._keepaCache.clear();
  extras._imageCache.clear();
  const realFetch = global.fetch;
  const kt = (msAgo) => Math.round((Date.now() - msAgo) / 60000) - 21564000;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://serpapi.com/")) {
      return Response.json({ shopping_results: [
        { title: "boAt Airdopes 141", source: "Amazon.in", link: "https://www.amazon.in/dp/B09N3ZNHTY", extracted_price: 999, thumbnail: "https://encrypted-tbn0.gstatic.com/a" },
        { title: "boAt Airdopes 141", source: "Flipkart", link: "https://www.flipkart.com/boat/p/itm1", extracted_price: 1099, thumbnail: "https://encrypted-tbn0.gstatic.com/b" },
      ] });
    }
    if (u.startsWith("https://api.keepa.com/product")) {
      assert.match(u, /domain=10/);
      assert.match(u, /asin=B09N3ZNHTY/);
      return Response.json({ products: [{
        asin: "B09N3ZNHTY",
        imagesCSV: "61KNJav3S9L.jpg,71x.jpg",
        csv: [[kt(140 * DAY), 149900, kt(70 * DAY), 129900, kt(2 * DAY), 99900], [kt(100 * DAY), 119900]],
      }] });
    }
    if (u === "https://www.flipkart.com/boat/p/itm1") {
      return new Response('<html><meta property="og:image" content="https://rukminim2.flixcart.com/image/312/312/boat.jpeg"></html>', { headers: { "content-type": "text/html" } });
    }
    return new Response("", { status: 503 });
  };
  t.after(() => {
    global.fetch = realFetch;
    Object.assign(config, { serpApiKey: saved.serp, tavilyApiKey: saved.tavily, keepaApiKey: saved.keepa });
    deals._cache.clear(); deals._tracked.clear(); history._memory.clear(); extras._keepaCache.clear(); extras._imageCache.clear();
  });

  const res = await deals.findDeals("airdopes 141", "in", { force: true });
  const amazon = res.items.find((i) => i.store === "Amazon");
  const flipkart = res.items.find((i) => i.store === "Flipkart");
  assert.equal(amazon.image, "https://m.media-amazon.com/images/I/61KNJav3S9L.jpg");
  assert.equal(amazon.history.source, "keepa");
  assert.ok(amazon.history.coveredDays >= 139);
  assert.equal(amazon.history.isWindowLow, true);
  assert.equal(amazon.externalHistory, undefined);
  assert.equal(flipkart.image, "https://rukminim2.flixcart.com/image/832/832/boat.jpeg");
  assert.equal(flipkart.history.enoughHistory, false); // tracking just began
  assert.equal(flipkart.history.isWindowLow, false);
});

test("resolvePhotos finds the store's original photo before falling back to a thumbnail", async (t) => {
  extras._imageCache.clear();
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    // Amazon by-ASIN photo: real JPEG for one ASIN, 1×1 placeholder for another.
    if (u.includes("/images/P/B0GOODPHOT.01.L.jpg")) return new Response(new Uint8Array(5000), { headers: { "content-type": "image/jpeg" } });
    if (u.includes("/images/P/")) return new Response(new Uint8Array(43), { headers: { "content-type": "image/gif" } });
    if (u.startsWith("https://www.amazon.in/")) return new Response("blocked", { status: 503 });
    if (u.startsWith("https://www.croma.com/")) return new Response("<html>bot wall</html>", { headers: { "content-type": "text/html" } });
    if (u.startsWith("https://www.bing.com/images/search")) {
      assert.match(decodeURIComponent(u), /site:croma\.com/);
      return new Response('<a class="iusc" m="{&quot;murl&quot;:&quot;https://evil.example/x.jpg&quot;}"></a>'
        + '<a class="iusc" m="{&quot;murl&quot;:&quot;https://media-ik.croma.com/prod/https://media.croma.com/image/upload/v1/Croma%20Assets/phone.png&quot;}"></a>', { headers: { "content-type": "text/html" } });
    }
    return new Response("", { status: 404 });
  };
  t.after(() => { global.fetch = realFetch; extras._imageCache.clear(); });

  const amazonStore = { id: "amazon", domain: "amazon.in" };
  const cromaStore = { id: "croma", domain: "croma.com" };
  const thumb = "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc";

  // Amazon: original photo by ASIN beats the Google thumbnail.
  let photos = await extras.resolvePhotos({ storeId: "amazon", title: "Echo Dot", url: "https://www.amazon.in/dp/B0GOODPHOT", image: thumb }, amazonStore, true);
  assert.equal(photos[0], "https://images-na.ssl-images-amazon.com/images/P/B0GOODPHOT.01.L.jpg");
  assert.equal(photos[photos.length - 1], thumb);

  // Croma: page has no og:image → Bing finds the photo on Croma's own CDN;
  // the off-store hit is ignored.
  photos = await extras.resolvePhotos({ storeId: "croma", title: "Samsung Galaxy S24", url: "https://www.croma.com/samsung/p/1", image: null }, cromaStore, true);
  assert.equal(photos.length, 1);
  assert.match(photos[0], /^https:\/\/media-ik\.croma\.com\//);

  // A store-CDN photo already present is kept and nothing else is fetched.
  const before = seen.length;
  photos = await extras.resolvePhotos({ storeId: "amazon", title: "x", url: "https://www.amazon.in/dp/B0NOPHOTO1", image: "https://m.media-amazon.com/images/I/71a._AC_UY218_.jpg" }, amazonStore, true);
  assert.deepEqual(photos, ["https://m.media-amazon.com/images/I/71a._AC_SL1000_.jpg"]);
  assert.equal(seen.length, before);
});

test("Canopy supplies Amazon offers with Amazon's original photos, merged with other stores", async (t) => {
  const history = require("../src/services/priceHistoryService");
  const canopy = require("../src/services/canopyService");
  const saved = { serp: config.serpApiKey, tavily: config.tavilyApiKey, keepa: config.keepaApiKey, canopy: config.canopyApiKey };
  Object.assign(config, { serpApiKey: "test-key", tavilyApiKey: "", keepaApiKey: "", canopyApiKey: "canopy-key" });
  deals._cache.clear(); history._memory.clear(); extras._imageCache.clear(); canopy._productCache.clear();
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://rest.canopyapi.co/api/amazon/search")) {
      assert.equal(opts.headers["API-KEY"], "canopy-key");
      assert.match(u, /searchTerm=boat\+airdopes/);
      assert.match(u, /domain=IN/);
      return Response.json({ data: { amazonProductSearchResults: { productResults: { results: [
        { title: "boAt Airdopes 141 TWS Earbuds", asin: "B09N3ZNHTY", price: { display: "₹999", value: 999, currency: "INR", symbol: "₹" }, rating: 4.1, ratingsTotal: 250000, isPrime: true, sponsored: false,
          mainImageUrl: "https://m.media-amazon.com/images/I/61KNJav3S9L.jpg", imageUrls: ["https://m.media-amazon.com/images/I/61KNJav3S9L.jpg", "https://m.media-amazon.com/images/I/71side.jpg"] },
        { title: "Sponsored earbuds", asin: "B0SPONSOR1", price: { value: 499 }, sponsored: true, mainImageUrl: "https://m.media-amazon.com/images/I/ad.jpg" },
      ] } } } });
    }
    if (u.startsWith("https://rest.canopyapi.co/api/amazon/product")) {
      assert.match(u, /asin=B0OTHERAMZ/);
      return Response.json({ data: { amazonProduct: { asin: "B0OTHERAMZ", mainImageUrl: "https://m.media-amazon.com/images/I/81other.jpg", imageUrls: [] } } });
    }
    if (u.startsWith("https://serpapi.com/")) {
      return Response.json({ shopping_results: [
        // Same ASIN as Canopy's → dropped in favour of Canopy's listing.
        { title: "boAt Airdopes 141", source: "Amazon.in", link: "https://www.amazon.in/dp/B09N3ZNHTY", extracted_price: 1049, thumbnail: "https://encrypted-tbn0.gstatic.com/a" },
        // Another Amazon listing → its photo comes from Canopy's product endpoint.
        { title: "boAt Airdopes 131", source: "Amazon.in", link: "https://www.amazon.in/dp/B0OTHERAMZ", extracted_price: 899, thumbnail: "https://encrypted-tbn0.gstatic.com/b" },
        { title: "boAt Airdopes 141", source: "Flipkart", link: "https://www.flipkart.com/boat/p/itm1", extracted_price: 1099, thumbnail: "https://rukminim2.flixcart.com/image/312/312/boat.jpeg" },
      ] });
    }
    return new Response("", { status: 503 });
  };
  t.after(() => {
    global.fetch = realFetch;
    Object.assign(config, { serpApiKey: saved.serp, tavilyApiKey: saved.tavily, keepaApiKey: saved.keepa, canopyApiKey: saved.canopy });
    deals._cache.clear(); deals._tracked.clear(); history._memory.clear(); extras._imageCache.clear(); canopy._productCache.clear();
  });

  const res = await deals.findDeals("boat airdopes", "in", { force: true });
  assert.equal(res.provider, "google-shopping+canopy");
  assert.deepEqual(res.items.map((i) => [i.store, i.price]), [["Amazon", 899], ["Amazon", 999], ["Flipkart", 1099]]);
  const fromCanopy = res.items.find((i) => i.price === 999);
  assert.equal(fromCanopy.url, "https://www.amazon.in/dp/B09N3ZNHTY");
  assert.equal(fromCanopy.image, "https://m.media-amazon.com/images/I/61KNJav3S9L.jpg");
  assert.equal(fromCanopy.images.length, 2);
  assert.equal(fromCanopy.reviews, 250000);
  assert.equal(fromCanopy.delivery, "Prime delivery");
  const other = res.items.find((i) => i.price === 899);
  assert.equal(other.image, "https://m.media-amazon.com/images/I/81other.jpg");
  assert.ok(!res.items.some((i) => i.price === 499), "sponsored results are left out");
  assert.ok(!calls.some((u) => u.includes("images-na.ssl-images-amazon.com")), "Canopy's photo made the fallbacks unnecessary");
});

test("Canopy price parsing", () => {
  const canopy = require("../src/services/canopyService");
  assert.equal(canopy.priceValue({ value: 1299.5 }), 1299.5);
  assert.equal(canopy.priceValue({ display: "₹1,299" }), 1299);
  assert.equal(canopy.priceValue(null), null);
  assert.deepEqual(canopy.photosOf({ mainImageUrl: "https://a/1.jpg", imageUrls: ["https://a/1.jpg", "https://a/2.jpg", null] }), ["https://a/1.jpg", "https://a/2.jpg"]);
});

test("RapidAPI Real-Time Product Search supplies multi-store offers with original photos", async (t) => {
  const history = require("../src/services/priceHistoryService");
  const productSearch = require("../src/services/productSearchService");
  const saved = { ps: config.productSearchRapidApiKey, serp: config.serpApiKey, tavily: config.tavilyApiKey, keepa: config.keepaApiKey, canopy: config.canopyApiKey };
  Object.assign(config, { productSearchRapidApiKey: "rapid-key", serpApiKey: "", tavilyApiKey: "", keepaApiKey: "", canopyApiKey: "" });
  deals._cache.clear(); history._memory.clear(); extras._imageCache.clear();
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://real-time-product-search.p.rapidapi.com/search-v2")) {
      assert.equal(opts.headers["X-RapidAPI-Key"], "rapid-key");
      assert.equal(opts.headers["X-RapidAPI-Host"], "real-time-product-search.p.rapidapi.com");
      assert.match(u, /q=iphone\+15/);
      assert.match(u, /country=in/);
      return Response.json({ status: "OK", data: { products: [
        { product_title: "Apple iPhone 15 (128 GB) - Black", product_photos: ["https://m.media-amazon.com/images/I/71657TiFeHL._AC_SL1500_.jpg", "https://m.media-amazon.com/images/I/2.jpg"],
          product_rating: 4.5, product_num_reviews: 1200,
          offer: { offer_page_url: "https://www.amazon.in/dp/B0CHX1W1XY", price: "₹69,900.00", original_price: "₹79,900.00", store_name: "Amazon.in" } },
        { product_title: "Apple iPhone 15 (Black, 128 GB)", product_photos: ["https://rukminim2.flixcart.com/image/416/416/xif0q/mobile/h/d/9/-original.jpeg"],
          offer: { offer_page_url: "https://www.flipkart.com/apple-iphone-15/p/itm6ac", price: "₹65,999", store_name: "Flipkart" } },
        { product_title: "Apple iPhone 15 128GB", product_photos: ["https://www.vijaysales.com/media/iphone.jpg"],
          offer: { offer_page_url: "https://www.vijaysales.com/apple-iphone-15", price: "₹67,490", store_name: "Vijay Sales" } },
        { product_title: "No price", offer: { offer_page_url: "https://x.example", store_name: "X" } },
      ] } });
    }
    return new Response("", { status: 503 });
  };
  t.after(() => {
    global.fetch = realFetch;
    Object.assign(config, { productSearchRapidApiKey: saved.ps, serpApiKey: saved.serp, tavilyApiKey: saved.tavily, keepaApiKey: saved.keepa, canopyApiKey: saved.canopy });
    deals._cache.clear(); deals._tracked.clear(); history._memory.clear(); extras._imageCache.clear();
  });

  const res = await deals.findDeals("iphone 15", "in", { force: true });
  assert.equal(res.provider, "product-search");
  assert.deepEqual(res.items.map((i) => [i.store, i.price]), [["Flipkart", 65999], ["Vijay Sales", 67490], ["Amazon", 69900]]);
  const amazon = res.items.find((i) => i.store === "Amazon");
  assert.equal(amazon.storeColor, "#ff9900");
  assert.equal(amazon.originalPrice, 79900);
  assert.equal(amazon.discountPct, 13);
  assert.equal(amazon.image, "https://m.media-amazon.com/images/I/71657TiFeHL._AC_SL1000_.jpg");
  assert.equal(amazon.url, "https://www.amazon.in/dp/B0CHX1W1XY");
  const flipkart = res.items.find((i) => i.store === "Flipkart");
  assert.equal(flipkart.image, "https://rukminim2.flixcart.com/image/832/832/xif0q/mobile/h/d/9/-original.jpeg");
  // Photos came with the offers, so no page or Bing lookups were needed.
  assert.ok(!calls.some((u) => u.includes("bing.com") || u.includes("flipkart.com/apple")));
  assert.ok(!calls.some((u) => u.includes("serpapi.com")));

  // Older response shape: data is the product array itself.
  assert.equal(productSearch.productsOf({ data: [{ product_title: "a" }] }).length, 1);
  assert.equal(productSearch.parsePrice("Rs. 1,29,999.50"), 129999.5);
  assert.equal(productSearch.parsePrice("$249.99"), 249.99);
  assert.equal(productSearch.parsePrice(""), null);
});

test("the hourly refresh skips featured searches for regions nobody opened", async (t) => {
  const saved = { ps: config.productSearchRapidApiKey, serp: config.serpApiKey, tavily: config.tavilyApiKey };
  Object.assign(config, { productSearchRapidApiKey: "rapid-key", serpApiKey: "", tavilyApiKey: "" });
  deals._cache.clear(); deals._tracked.clear(); deals._featuredUsed.clear();
  const realFetch = global.fetch;
  const countries = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("rapidapi.com")) { countries.push(new URL(u).searchParams.get("country")); return Response.json({ data: [] }); }
    return new Response("", { status: 503 });
  };
  t.after(() => { global.fetch = realFetch; Object.assign(config, { productSearchRapidApiKey: saved.ps, serpApiKey: saved.serp, tavilyApiKey: saved.tavily }); deals._cache.clear(); deals._tracked.clear(); deals._featuredUsed.clear(); });

  await deals.refreshAll();
  assert.equal(countries.length, 0, "no region in use → no paid calls");

  deals._featuredUsed.set("in", Date.now());
  await deals.refreshAll();
  assert.ok(countries.length > 0);
  assert.ok(countries.every((c) => c === "in"), "only India's featured rails were refreshed");
});
