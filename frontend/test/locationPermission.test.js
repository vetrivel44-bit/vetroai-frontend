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
  assert.equal(nearbyTitle("atm"), "ATMs");
  assert.equal(nearbyTitle("pg"), "PGs");
  assert.equal(nearbyTitle("ev charging"), "EV charging");
  assert.equal(nearbyTitle("parking"), "Parking");
  assert.equal(nearbyTitle("bus"), "Bus stops");
  assert.equal(nearbyTitle("pharmacy"), "Pharmacies");
  assert.equal(nearbyTitle("pharmacy"), "Pharmacies");
});

test("recognises the ways people ask for places nearby", async () => {
  const { isNearbyRequest } = await import("../src/utils/locationPermission.js");
  for (const q of ["hotels near me", "restaurants near by", "biryani close to me", "salons in my area", "nearest petrol bunk",
    "closest ATM?", "mere paas hospital", "atm aas paas", "Where can I eat near my hostel", "pharmacy within walking distance"]) {
    assert.equal(isNearbyRequest(q), true, q);
  }
  for (const q of ["explain the nearest neighbour algorithm", "round 4.6 to the nearest integer", "closest pair of points problem",
    "what is photosynthesis", "write a story about a nearby planet"]) {
    assert.equal(isNearbyRequest(q), false, q);
  }
});

test("turns 'where can I eat' and 'a place to stay' into the kind of place", async () => {
  const { nearbySubject } = await import("../src/utils/locationPermission.js");
  assert.equal(nearbySubject("Where can I eat near my hostel"), "restaurants");
  assert.equal(nearbySubject("any place to stay nearby?"), "hotels");
  assert.equal(nearbySubject("restaurants near by"), "restaurants");
  assert.equal(nearbySubject("salons in my area"), "salons");
});
