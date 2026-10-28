import test from "node:test";
import assert from "node:assert/strict";

import { placePoints } from "../src/lib/places.js";

test("places listed as highlights are pinned, each once", () => {
  // The "best tourist places in Tamil Nadu" reply: places under `highlights`
  // with `name`, and Kanyakumari three times.
  const kanyakumari = { name: "Kanyakumari", lat: 8.0883, lng: 77.5385, note: "Southern tip of India" };
  const pins = placePoints({
    type: "location",
    place: "Tamil Nadu, India",
    coordinates: { lat: 11.5, lng: 78.5 },
    highlights: [
      { name: "Chennai", lat: 13.0827, lng: 80.2707, note: "Marina Beach" },
      kanyakumari,
      { name: "Madurai", lat: 9.9252, lng: 78.1198 },
      kanyakumari,
      { ...kanyakumari, name: "kanyakumari " },
    ],
  });
  assert.deepEqual(pins.map((p) => p.label), ["Chennai", "Kanyakumari", "Madurai"]);
  assert.equal(pins[0].note, "Marina Beach");
});

test("points, places and markers all count; bad coordinates are skipped", () => {
  const pins = placePoints({
    points: [{ label: "A", lat: 1, lng: 2 }],
    places: [{ name: "B", latitude: "3", longitude: "4" }],
    markers: [{ name: "C", lat: 200, lng: 5 }, { name: "D", lat: "", lng: 1 }],
  });
  assert.deepEqual(pins.map((p) => [p.label, p.lat, p.lng]), [["A", 1, 2], ["B", 3, 4]]);
  assert.deepEqual(placePoints({ type: "location", place: "Chennai" }), []);
});
