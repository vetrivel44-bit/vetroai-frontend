import test from "node:test";
import assert from "node:assert/strict";

import { directionsUrl, driveTime, fetchRoute, formatDistance, mapsSearchUrl, openingStatus, phoneUrl, placeStatus, travelTime, websiteUrl } from "../src/lib/nearbyFormat.js";

// Wednesday 14 Oct 2026 (the 17th is a Saturday), local time.
const at = (h, m = 0, date = 14) => new Date(2026, 9, date, h, m);

test("distances and travel times", () => {
  assert.equal(formatDistance(4), "10 m");
  assert.equal(formatDistance(347), "350 m");
  assert.equal(formatDistance(1530), "1.5 km");
  assert.equal(formatDistance(12400), "12 km");
  assert.equal(travelTime(400), "5 min walk");
  assert.equal(travelTime(30), "1 min walk");
  assert.equal(travelTime(6000), "15 min drive");
  assert.equal(travelTime(null), "");
});

test("reads common opening hours", () => {
  assert.deepEqual(openingStatus("24/7", at(3)), { open: true, label: "Open 24 hours" });
  assert.deepEqual(openingStatus("Mo-Sa 09:00-21:00; Su off", at(10)), { open: true, label: "Open · closes 9 PM" });
  assert.deepEqual(openingStatus("Mo-Sa 09:00-21:00; Su off", at(7, 30)), { open: false, label: "Closed · opens 9 AM" });
  assert.deepEqual(openingStatus("Mo-Sa 09:00-21:00; Su off", at(22)), { open: false, label: "Closed · opens 9 AM" });
  // Saturday night → next opening is Monday.
  assert.deepEqual(openingStatus("Mo-Sa 09:00-21:00; Su off", at(22, 0, 17)), { open: false, label: "Closed · opens Mo 9 AM" });
  // Split shifts.
  assert.deepEqual(openingStatus("11:00-15:00,18:30-23:00", at(16)), { open: false, label: "Closed · opens 6:30 PM" });
  assert.deepEqual(openingStatus("11:00-15:00,18:30-23:00", at(19)), { open: true, label: "Open · closes 11 PM" });
  // Past midnight, both before and after 12.
  assert.deepEqual(openingStatus("Mo-Su 18:00-02:00", at(23)), { open: true, label: "Open · closes 2 AM" });
  assert.deepEqual(openingStatus("Mo-Su 18:00-02:00", at(1)), { open: true, label: "Open · closes 2 AM" });
  // Later rules override earlier ones for their days.
  assert.equal(openingStatus("Mo-Su 10:00-22:00; We off", at(12)).open, false);
});

test("leaves hours it can't read alone", () => {
  assert.equal(openingStatus("", at(10)), null);
  assert.equal(openingStatus("sunrise-sunset", at(10)), null);
  assert.equal(openingStatus("Mo-Fr 09:00-17:00; PH off", at(10)), null);
  assert.equal(openingStatus("by appointment", at(10)), null);
});

test("Google's open flag wins over hours", () => {
  assert.deepEqual(placeStatus({ openNow: true, hours: "Mo off" }), { open: true, label: "Open now" });
  assert.deepEqual(placeStatus({ openNow: false }), { open: false, label: "Closed now" });
  assert.equal(placeStatus({ openNow: null, hours: null }), null);
});

test("links", () => {
  const center = { lat: 13.03, lng: 77.56 };
  const url = new URL(directionsUrl(center, { location: { lat: 13.04, lng: 77.57 }, distanceMeters: 900, placeId: "osm:node/1" }));
  assert.equal(url.searchParams.get("travelmode"), "walking");
  assert.equal(url.searchParams.get("origin"), "13.03,77.56");
  assert.equal(url.searchParams.get("destination_place_id"), null, "OpenStreetMap ids aren't Google place ids");
  assert.equal(mapsSearchUrl("biryani restaurants", center), "https://www.google.com/maps/search/biryani%20restaurants/@13.03,77.56,15z");
  assert.equal(websiteUrl("example.com"), "https://example.com");
  assert.equal(websiteUrl(""), null);
  assert.equal(phoneUrl("+91 80 2345 6789; +91 98450 00000"), "tel:+918023456789");
  assert.equal(phoneUrl("n/a"), null);
});

test("the road route to a place, and its drive time", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ routes: [{ distance: 2480, duration: 540, geometry: { coordinates: [[77.56, 13.03], [77.57, 13.04], [77.58, 13.05]] } }] }) };
  };
  const route = await fetchRoute({ lat: 13.03, lng: 77.56 }, { lat: 13.05, lng: 77.58 }, { fetchImpl });
  assert.equal(route.meters, 2480);
  assert.equal(route.coords.length, 3);
  assert.match(calls[0], /route\/v1\/driving\/77\.56,13\.03;77\.58,13\.05\?overview=full&geometries=geojson$/);
  assert.equal(driveTime(540), "9 min drive");
  assert.equal(driveTime(5400), "1 hr 30 min drive");
  // No route (router down, or nothing found) is null, never an error.
  assert.equal(await fetchRoute({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { fetchImpl: async () => { throw new TypeError("offline"); } }), null);
  assert.equal(await fetchRoute({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { fetchImpl: async () => ({ ok: true, json: async () => ({ code: "NoRoute", routes: [] }) }) }), null);
});
