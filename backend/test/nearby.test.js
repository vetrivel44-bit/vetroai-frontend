const test = require("node:test");
const assert = require("node:assert/strict");

const nearby = require("../src/services/nearbyService");

function withFetch(impl, run) {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => { global.fetch = original; });
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Map() });

const HOME = { lat: 13.0306, lng: 77.5649 };

test("maps what was asked for to a kind of place", () => {
  assert.equal(nearby.kindFor("restaurant near me").label, "Restaurant");
  assert.equal(nearby.kindFor("Give the restaurant near me").label, "Restaurant");
  assert.equal(nearby.kindFor("nearest ATM").label, "ATM");
  assert.equal(nearby.kindFor("coffee shops around me").label, "Café");
  assert.equal(nearby.kindFor("my friend's house"), null);
});

test("names places by cuisine", () => {
  const restaurant = nearby.kindFor("restaurant");
  assert.equal(nearby.categoryOf({ amenity: "restaurant", cuisine: "chinese;indian" }, restaurant), "Chinese restaurant");
  assert.equal(nearby.categoryOf({ amenity: "restaurant", cuisine: "south_indian" }, restaurant), "South Indian restaurant");
  assert.equal(nearby.categoryOf({ amenity: "fast_food" }, restaurant), "Fast food");
  assert.equal(nearby.categoryOf({ amenity: "restaurant" }, restaurant), "Restaurant");
});

test("finds places with Overpass, nearest first, without duplicates", async () => {
  let body = "";
  const elements = [
    { type: "node", id: 1, lat: 13.0400, lon: 77.5649, tags: { name: "Far Diner", amenity: "restaurant" } },
    { type: "node", id: 2, lat: 13.0310, lon: 77.5652, tags: { name: "Ajs Kitchen", amenity: "restaurant", cuisine: "chinese", "addr:street": "BEL Road" } },
    { type: "way", id: 3, center: { lat: 13.0310, lon: 77.5652 }, tags: { name: "Ajs Kitchen", amenity: "restaurant" } },
    { type: "node", id: 4, lat: 13.0330, lon: 77.5660, tags: { name: "Vantalu", amenity: "restaurant", cuisine: "andhra" } },
  ];
  await withFetch(async (url, opts) => { body = decodeURIComponent(opts.body); return json({ elements }); }, async () => {
    const places = await nearby.searchOverpass(nearby.kindFor("restaurants"), HOME, { limit: 8 });
    assert.deepEqual(places.map((p) => p.name), ["Ajs Kitchen", "Vantalu", "Far Diner"]);
    assert.equal(places[0].category, "Chinese restaurant");
    assert.equal(places[0].address, "BEL Road");
    assert.ok(places[0].distanceMeters < 100);
    assert.match(places[0].mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\//);
  });
  assert.match(body, /nwr\["amenity"="restaurant"\]\["name"\]\(around:1500,13\.0306,77\.5649\)/);
});

test("widens the search when only a couple of places are close", async () => {
  const radii = [];
  await withFetch(async (url, opts) => {
    radii.push(/around:(\d+)/.exec(decodeURIComponent(opts.body))[1]);
    return json({ elements: [{ type: "node", id: 1, lat: 13.031, lon: 77.565, tags: { name: "Only One", amenity: "atm" } }] });
  }, async () => {
    const places = await nearby.searchOverpass(nearby.kindFor("atm"), HOME);
    assert.equal(places.length, 1);
  });
  assert.deepEqual(radii, ["1500", "4000"]);
});

test("names the neighbourhood, and gives up quietly", async () => {
  await withFetch(async () => json({ address: { suburb: "Mathikere", city: "Bengaluru" } }), async () => {
    assert.equal(await nearby.areaName(HOME), "Mathikere");
  });
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    assert.equal(await nearby.areaName(HOME), null);
  });
});

test("GET /maps/search near a location returns nearby places and the area", async () => {
  delete require.cache[require.resolve("../src/controllers/mapsController")];
  const maps = require("../src/controllers/mapsController");
  const res = { payload: null, json(body) { this.payload = body; return this; } };
  await withFetch(async (url) => {
    if (String(url).includes("overpass")) return json({ elements: [{ type: "node", id: 9, lat: 13.031, lon: 77.565, tags: { name: "Ajs Kitchen", amenity: "restaurant", cuisine: "chinese" } }, { type: "node", id: 8, lat: 13.032, lon: 77.566, tags: { name: "B", amenity: "restaurant" } }, { type: "node", id: 7, lat: 13.033, lon: 77.567, tags: { name: "C", amenity: "restaurant" } }] });
    if (String(url).includes("reverse")) return json({ address: { suburb: "Mathikere" } });
    throw new Error(`unexpected ${url}`);
  }, () => maps.searchPlaces({ query: { query: "restaurant", lat: "13.0306", lng: "77.5649", limit: "6" } }, res));
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.meta.area, "Mathikere");
  assert.equal(res.payload.data[0].name, "Ajs Kitchen");
  assert.equal(res.payload.data[0].category, "Chinese restaurant");
  assert.ok(!JSON.stringify(res.payload).includes("key="), "no API key in the response");
});

test("place photos need Google and never expose the key", async () => {
  const maps = require("../src/controllers/mapsController");
  await assert.rejects(() => maps.placePhoto({ query: { ref: "abc" } }, {}), /No photo/);
});
