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
