const logger = require("../utils/logger");

// "Restaurants near me" without a Google key. Nominatim's text search (the old
// fallback) ranks by importance, not distance, across a ~110 km box, so a
// nearby request got famous places far away. OpenStreetMap's Overpass API
// answers the real question: places of this kind within walking distance,
// nearest first.

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "VetroAI-Maps/1.0 (nearby places)";
const TIMEOUT_MS = 9000;

// What the user asked for → OpenStreetMap tags, and how to name one.
const KINDS = [
  { re: /\b(restaurants?|food|eat|dinner|lunch|biryani|dosa|pizza|meal|dhaba)\b/i, tags: [["amenity", "restaurant"], ["amenity", "fast_food"]], label: "Restaurant" },
  { re: /\b(caf[eé]s?|coffee|tea shop|bakery|bakeries)\b/i, tags: [["amenity", "cafe"], ["shop", "bakery"]], label: "Café" },
  { re: /\b(bars?|pubs?|brewery)\b/i, tags: [["amenity", "bar"], ["amenity", "pub"]], label: "Bar" },
  { re: /\b(hospitals?|clinics?|doctors?)\b/i, tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"]], label: "Hospital" },
  { re: /\b(pharmac(y|ies)|chemists?|medical stores?)\b/i, tags: [["amenity", "pharmacy"]], label: "Pharmacy" },
  { re: /\b(atms?)\b/i, tags: [["amenity", "atm"]], label: "ATM" },
  { re: /\b(banks?)\b/i, tags: [["amenity", "bank"]], label: "Bank" },
  { re: /\b(petrol|gas station|fuel|petrol bunk)\b/i, tags: [["amenity", "fuel"]], label: "Fuel station" },
  { re: /\b(hotels?|lodges?|stay|hostels?)\b/i, tags: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"]], label: "Hotel" },
  { re: /\b(supermarkets?|grocer(y|ies)|groceries|kirana)\b/i, tags: [["shop", "supermarket"], ["shop", "convenience"]], label: "Grocery" },
  { re: /\b(malls?|shopping)\b/i, tags: [["shop", "mall"]], label: "Mall" },
  { re: /\b(gyms?|fitness)\b/i, tags: [["leisure", "fitness_centre"]], label: "Gym" },
  { re: /\b(parks?|gardens?)\b/i, tags: [["leisure", "park"]], label: "Park" },
  { re: /\b(police)\b/i, tags: [["amenity", "police"]], label: "Police station" },
  { re: /\b(temples?|churches|church|mosques?|gurudwaras?)\b/i, tags: [["amenity", "place_of_worship"]], label: "Place of worship" },
  { re: /\b(schools?)\b/i, tags: [["amenity", "school"]], label: "School" },
  { re: /\b(colleges?|universit(y|ies))\b/i, tags: [["amenity", "college"], ["amenity", "university"]], label: "College" },
  { re: /\b(cinemas?|movie theat(er|re)s?|theat(er|re)s?)\b/i, tags: [["amenity", "cinema"]], label: "Cinema" },
  { re: /\b(bus stops?|bus stations?)\b/i, tags: [["highway", "bus_stop"], ["amenity", "bus_station"]], label: "Bus stop" },
  { re: /\b(metro|railway stations?|train stations?)\b/i, tags: [["railway", "station"]], label: "Station" },
  { re: /\b(parking)\b/i, tags: [["amenity", "parking"]], label: "Parking" },
  { re: /\b(toilets?|restrooms?|washrooms?)\b/i, tags: [["amenity", "toilets"]], label: "Toilets" },
];

/** The OpenStreetMap kind for a query, or null when it isn't a place type. */
function kindFor(query) {
  return KINDS.find((k) => k.re.test(String(query || ""))) || null;
}

const titleCase = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "chinese;indian" + restaurant → "Chinese restaurant"
function categoryOf(tags = {}, kind) {
  const cuisine = String(tags.cuisine || "").split(/[;,]/)[0].trim();
  if (tags.amenity === "fast_food") return cuisine ? `${titleCase(cuisine)} fast food` : "Fast food";
  if (cuisine && (tags.amenity === "restaurant" || tags.amenity === "cafe")) return `${titleCase(cuisine)} ${tags.amenity === "cafe" ? "café" : "restaurant"}`;
  if (tags.shop === "bakery") return "Bakery";
  if (tags.amenity === "clinic") return "Clinic";
  if (tags.amenity === "doctors") return "Doctor";
  if (tags.amenity === "pub") return "Pub";
  return kind?.label || titleCase(tags.amenity || tags.shop || tags.tourism || tags.leisure || "Place");
}

function distanceMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function addressOf(tags = {}) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [street, tags["addr:suburb"] || tags["addr:neighbourhood"], tags["addr:city"]].filter(Boolean).join(", ");
}

function overpassQuery(kind, { lat, lng }, radius, max) {
  const lines = kind.tags.map(([k, v]) => `nwr["${k}"="${v}"]["name"](around:${radius},${lat},${lng});`).join("");
  return `[out:json][timeout:10];(${lines});out center tags ${max};`;
}

/** Places of `kind` near `center`, nearest first. Throws on network errors. */
async function searchOverpass(kind, center, { limit = 8 } = {}) {
  for (const radius of [1500, 4000]) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: `data=${encodeURIComponent(overpassQuery(kind, center, radius, 80))}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = await res.json();
    const places = (json.elements || []).map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const tags = el.tags || {};
      const location = { lat, lng };
      return {
        placeId: `osm:${el.type}/${el.id}`,
        name: tags.name,
        address: addressOf(tags),
        location,
        rating: null,
        reviews: null,
        openNow: null,
        hours: tags.opening_hours || null,
        category: categoryOf(tags, kind),
        phone: tags.phone || tags["contact:phone"] || null,
        website: tags.website || tags["contact:website"] || null,
        photoRef: null,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tags.name} ${lat},${lng}`)}`,
        source: "osm",
        distanceMeters: distanceMeters(center, location),
      };
    }).filter(Boolean);
    // One branch of a chain can be mapped as both a node and a building.
    const seen = new Set();
    const unique = places.sort((a, b) => a.distanceMeters - b.distanceMeters).filter((p) => {
      const key = `${p.name.toLowerCase()}|${Math.round(p.location.lat * 2000)}|${Math.round(p.location.lng * 2000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length >= 3 || radius === 4000) return unique.slice(0, limit);
  }
  return [];
}

/** The neighbourhood the user is in ("Mathikere"), or null. Never throws. */
async function areaName({ lat, lng }) {
  try {
    const url = `${NOMINATIM_REVERSE}?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const a = (await res.json())?.address || {};
    return a.neighbourhood || a.suburb || a.quarter || a.city_district || a.village || a.town || a.city || null;
  } catch (err) {
    logger.warn("nearby.areaNameFailed", { error: err.message });
    return null;
  }
}

module.exports = { kindFor, categoryOf, searchOverpass, areaName, distanceMeters };
