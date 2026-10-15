import test from "node:test";
import assert from "node:assert/strict";

import { nearbySubject, nearbyTitle } from "../src/utils/locationPermission.js";

test("pulls the kind of place out of a near-me request", () => {
  assert.equal(nearbySubject("Give the restaurant near me"), "restaurant");
  assert.equal(nearbySubject("Show me the best coffee shops nearby?"), "coffee shops");
  assert.equal(nearbySubject("nearest pharmacy"), "pharmacy");
  assert.equal(nearbySubject("near me"), "places");
});

test("titles the map", () => {
  assert.equal(nearbyTitle("restaurant"), "Restaurants");
  assert.equal(nearbyTitle("coffee shops"), "Coffee shops");
  assert.equal(nearbyTitle("pharmacy"), "Pharmacies");
});
