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
  await withFetch(async (url, opts) => { body ||= decodeURIComponent(opts.body); return json({ elements }); }, async () => {
    const places = await nearby.searchOverpass(nearby.kindFor("restaurants"), HOME, { limit: 8 });
    assert.deepEqual(places.map((p) => p.name), ["Ajs Kitchen", "Vantalu", "Far Diner"]);
    assert.equal(places[0].category, "Chinese restaurant");
    assert.equal(places[0].address, "BEL Road");
    assert.ok(places[0].distanceMeters < 100);
    assert.match(places[0].mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\//);
  });
  assert.match(body, /nwr\["amenity"="restaurant"\]\["name"\]\(around:2000,13\.0306,77\.5649\)/);
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
  // Each radius is one query (the first mirror answers every time).
  assert.deepEqual(radii, ["2000", "6000", "15000"]);
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

const restaurantsAt = (n) => Array.from({ length: n }, (_, i) => ({ type: "node", id: 100 + i, lat: 13.031 + i * 0.001, lon: 77.565, tags: { name: `Place ${i}`, amenity: "restaurant" } }));

test("understands many kinds of place, in the order that resolves overlaps", () => {
  const label = (q) => nearby.kindFor(q)?.label;
  assert.equal(label("hotels near me"), "Hotel");
  assert.equal(label("good lodges nearby"), "Hotel");
  assert.equal(label("biryani near me"), "Restaurant");
  assert.equal(label("pure veg restaurants"), "Restaurant");
  assert.equal(label("salon near me"), "Salon");
  assert.equal(label("dental clinic nearby"), "Dentist");
  assert.equal(label("pet clinic near me"), "Vet");
  assert.equal(label("eye hospital"), "Hospital");
  assert.equal(label("medical shop near me"), "Pharmacy");
  assert.equal(label("petrol bunk"), "Fuel station");
  assert.equal(label("bike repair near me"), "Mechanic");
  assert.equal(label("tourist places near me"), "Attraction");
  assert.equal(label("places to visit nearby"), "Attraction");
  assert.equal(label("fish market"), "Meat shop");
  assert.equal(label("ice cream parlour"), "Ice cream");
  assert.equal(label("wedding halls"), "Event venue");
  assert.equal(label("parking near me"), "Parking");
  assert.equal(label("parks near me"), "Park");
  assert.equal(nearby.kindFor("decathlon"), null);
});

test("searches by name when the query isn't a kind of place", async () => {
  assert.equal(nearby.nameTermFor("decathlon near me"), "decathlon");
  assert.equal(nearby.nameTermFor("the best places near me"), null);
  const q = nearby.overpassQuery({ name: "dominos" }, HOME, 2000);
  // Case-insensitive, and "dominos" also finds "Domino's".
  assert.match(q, /nwr\["name"~"domino'\?s",i\]\(around:2000,/);
  assert.match(q, /nwr\["brand"~"domino'\?s",i\]\["name"\]/);
  // Regex characters and quotes from the user can't break the query.
  assert.match(nearby.overpassQuery({ name: 'a.b"c' }, HOME, 2000), /"a\\\\\.b\\"c"/);
});

test("puts places matching what was asked first", () => {
  const p = (name, d, extra = {}) => ({ name, distanceMeters: d, location: { lat: 13 + d / 1e5, lng: 77 }, ...extra });
  const ranked = nearby.rankPlaces([p("Udupi Grand", 100), p("Biryani Zone", 900), p("Meghana Foods", 500, { cuisine: "biryani" })], nearby.preferTermsFor("biryani near me", nearby.kindFor("biryani")));
  assert.deepEqual(ranked.map((x) => x.name), ["Meghana Foods", "Biryani Zone", "Udupi Grand"]);
  const veg = nearby.rankPlaces([p("Non Veg Hut", 100), p("Green Leaf", 300, { vegetarian: "only" })], nearby.preferTermsFor("pure veg restaurants", nearby.kindFor("veg")));
  assert.equal(veg[0].name, "Green Leaf");
});

test("a busy Overpass server falls over to the next mirror", async () => {
  const hits = [];
  await withFetch(async (url) => {
    hits.push(String(url));
    if (String(url) === nearby.OVERPASS_URLS[0]) return json({}, 429);
    return json({ elements: restaurantsAt(5) });
  }, async () => {
    const result = await nearby.findNearby("restaurants", HOME);
    assert.equal(result.failed, false);
    assert.equal(result.source, "overpass");
    assert.equal(result.places.length, 5);
  });
  assert.equal(hits[0], nearby.OVERPASS_URLS[0]);
  assert.equal(hits[1], nearby.OVERPASS_URLS[1]);
});

test("when every Overpass mirror is down, Photon finds nearby places", async () => {
  await withFetch(async (url) => {
    if (String(url).includes("photon")) {
      assert.match(String(url), /lat=13\.0306&lon=77\.5649/);
      return json({ features: [
        { geometry: { coordinates: [77.566, 13.032] }, properties: { name: "Hotel Blue", osm_key: "tourism", osm_value: "hotel", osm_type: "N", osm_id: 5, street: "BEL Road" } },
        { geometry: { coordinates: [77.6, 13.1] }, properties: { name: "Bengaluru", osm_key: "place", osm_value: "city", osm_type: "R", osm_id: 6 } },
        { geometry: { coordinates: [78.5, 17.4] }, properties: { name: "Far Hotel", osm_key: "tourism", osm_value: "hotel", osm_type: "N", osm_id: 7 } },
      ] });
    }
    return json({}, 504);
  }, async () => {
    const result = await nearby.findNearby("hotels", HOME);
    assert.equal(result.source, "photon");
    assert.deepEqual(result.places.map((p) => p.name), ["Hotel Blue"], "cities and places 25+ km away are dropped");
    assert.equal(result.places[0].category, "Hotel");
  });
});

test("reports a failed search apart from an empty one", async () => {
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    const result = await nearby.findNearby("restaurants", HOME);
    assert.deepEqual(result.places, []);
    assert.equal(result.failed, true);
  });
  await withFetch(async (url) => (String(url).includes("photon") ? json({ features: [] }) : String(url).includes("nominatim") ? json([]) : json({ elements: [] })), async () => {
    const result = await nearby.findNearby("restaurants", HOME);
    assert.equal(result.failed, false, "every service answered: there really is nothing nearby");
  });
});

test("GET /maps/search near a location never 500s when the map services are down", async () => {
  const maps = require("../src/controllers/mapsController");
  const res = { payload: null, json(body) { this.payload = body; return this; } };
  await withFetch(async () => { throw new Error("offline"); }, () => maps.searchPlaces({ query: { query: "hotels", lat: "13.0306", lng: "77.5649" } }, res));
  assert.equal(res.payload.success, true);
  assert.deepEqual(res.payload.data, []);
  assert.equal(res.payload.meta.searchFailed, true);
});

test("'what's near me' searches a mix of popular places, each named by its own kind", async () => {
  let body = "";
  await withFetch(async (url, opts) => {
    body ||= decodeURIComponent(opts.body);
    return json({ elements: [
      { type: "node", id: 1, lat: 13.031, lon: 77.565, tags: { name: "Sankey Tank", leisure: "park" } },
      { type: "node", id: 2, lat: 13.032, lon: 77.565, tags: { name: "Cafe Noir", amenity: "cafe" } },
      { type: "node", id: 3, lat: 13.033, lon: 77.565, tags: { name: "Bangalore Palace", tourism: "attraction" } },
      { type: "node", id: 4, lat: 13.034, lon: 77.565, tags: { name: "Mantri Mall", shop: "mall" } },
    ] });
  }, async () => {
    const result = await nearby.findNearby("places", HOME);
    assert.deepEqual(result.places.map((p) => p.category), ["Park", "Cafe", "Attraction", "Mall"]);
  });
  assert.match(body, /"tourism"="attraction"/);
  assert.match(body, /"amenity"="restaurant"/);
});
