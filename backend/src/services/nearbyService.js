const logger = require("../utils/logger");

// "Restaurants near me" without a Google key, from OpenStreetMap.
//
// Overpass answers the real question — places of this kind around a point,
// nearest first — but its public servers are often busy and turn requests
// away (429/504), most of all from shared cloud hosts. A single server made
// "near me" fail outright, so each query tries several mirrors. When every
// mirror fails, Photon (a location-biased search) and then Nominatim are
// tried, and the caller is told plainly if all of them were down, rather than
// being handed an empty list that reads as "nothing nearby".

const OVERPASS_URLS = [...new Set([
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
].filter(Boolean))];
const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "VetroAI-Maps/1.1 (nearby places; https://vetroai.web.app)";
const TIMEOUT_MS = 9000;
// Walking distance, then the neighbourhood, then the wider town.
const RADII = [2000, 6000, 15000];
const ENOUGH = 4;
const FALLBACK_MAX_METERS = 25000;

// What the user asked for → OpenStreetMap tags, and how to name one. Order
// matters where words overlap: "dental clinic" is a dentist, "pet clinic" a
// vet, and both come before the general hospital/clinic entry.
const KINDS = [
  { re: /\b(dentists?|dental)\b/i, tags: [["amenity", "dentist"]], label: "Dentist" },
  { re: /\b(vets?|veterinar(y|ians?)|pet (clinic|hospital))\b/i, tags: [["amenity", "veterinary"]], label: "Vet" },
  { re: /\b(pet shops?|pet stores?)\b/i, tags: [["shop", "pet"]], label: "Pet shop" },
  { re: /\b(opticians?|opticals?|spectacles|eye ?glasses)\b/i, tags: [["shop", "optician"]], label: "Optician" },
  { re: /\b(hospitals?|clinics?|doctors?|emergency)\b/i, tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"]], label: "Hospital" },
  { re: /\b(pharmac(y|ies)|chemists?|medical (stores?|shops?)|medicals?)\b/i, tags: [["amenity", "pharmacy"]], label: "Pharmacy" },
  { re: /\b(hotels?|lodges?|lodging|stays?|hostels?|resorts?|motels?|guest ?houses?|homestays?|rooms? to stay)\b/i, tags: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"], ["tourism", "motel"], ["tourism", "apartment"]], label: "Hotel" },
  { re: /\b(ice ?creams?|gelato|desserts?)\b/i, tags: [["amenity", "ice_cream"], ["shop", "ice_cream"]], label: "Ice cream" },
  { re: /\b(sweets?|sweet shops?|mithai|confectioner(y|ies))\b/i, tags: [["shop", "confectionery"], ["shop", "pastry"]], label: "Sweet shop" },
  { re: /\b(caf[eé]s?|coffee|tea shops?|chai|bakery|bakeries|cake shops?)\b/i, tags: [["amenity", "cafe"], ["shop", "bakery"]], label: "Café" },
  { re: /\b(bars?|pubs?|brewer(y|ies)|nightlife)\b/i, tags: [["amenity", "bar"], ["amenity", "pub"]], label: "Bar" },
  { re: /\b(liquor|wine shops?|alcohol)\b/i, tags: [["shop", "alcohol"]], label: "Liquor store" },
  { re: /\b(restaurants?|food|eat|eating|dinner|lunch|breakfast|biryani|dosa|idli|pizza|burgers?|meals?|dhabas?|mess|veg|non[- ]?veg|chinese|north indian|south indian|street food|chaat|shawarma|noodles|kfc|mcdonald'?s|domino'?s)\b/i, tags: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]], label: "Restaurant" },
  { re: /\b(atms?|cash machines?)\b/i, tags: [["amenity", "atm"]], label: "ATM" },
  { re: /\b(banks?)\b/i, tags: [["amenity", "bank"]], label: "Bank" },
  { re: /\b(ev charging|charging stations?|ev chargers?)\b/i, tags: [["amenity", "charging_station"]], label: "EV charging" },
  { re: /\b(petrol|gas stations?|fuel|petrol bunks?|petrol pumps?|diesel)\b/i, tags: [["amenity", "fuel"]], label: "Fuel station" },
  { re: /\b(car wash(es)?)\b/i, tags: [["amenity", "car_wash"]], label: "Car wash" },
  { re: /\b(mechanics?|garages?|car repairs?|car service|bike repairs?|bike service|two wheeler service|punctures?|tyres?|tires?)\b/i, tags: [["shop", "car_repair"], ["shop", "motorcycle_repair"], ["shop", "tyres"]], label: "Mechanic" },
  { re: /\b(supermarkets?|grocer(y|ies)|groceries|kirana|provision stores?|departmental stores?|marts?)\b/i, tags: [["shop", "supermarket"], ["shop", "convenience"]], label: "Grocery" },
  { re: /\b(vegetables?|fruits?|greengrocers?)\b/i, tags: [["shop", "greengrocer"]], label: "Greengrocer" },
  { re: /\b(meat|chicken shops?|butchers?|fish|seafood)\b/i, tags: [["shop", "butcher"], ["shop", "seafood"]], label: "Meat shop" },
  { re: /\b(malls?|shopping)\b/i, tags: [["shop", "mall"], ["shop", "department_store"]], label: "Mall" },
  { re: /\b(clothes|clothing|garments?|boutiques?|dress shops?)\b/i, tags: [["shop", "clothes"]], label: "Clothes" },
  { re: /\b(shoes?|footwear)\b/i, tags: [["shop", "shoes"]], label: "Shoes" },
  { re: /\b(electronics?|mobile shops?|phone shops?|mobile stores?|mobile service)\b/i, tags: [["shop", "electronics"], ["shop", "mobile_phone"]], label: "Electronics" },
  { re: /\b(book ?shops?|book ?stores?|books)\b/i, tags: [["shop", "books"]], label: "Bookstore" },
  { re: /\b(stationery|xerox|photocop(y|ies)|printing|print shops?)\b/i, tags: [["shop", "stationery"], ["shop", "copyshop"]], label: "Stationery" },
  { re: /\b(hardware|paint shops?|tools)\b/i, tags: [["shop", "hardware"], ["shop", "doityourself"]], label: "Hardware" },
  { re: /\b(jewel(le)?ry|jewell?ers?|gold shops?)\b/i, tags: [["shop", "jewelry"]], label: "Jeweller" },
  { re: /\b(florists?|flower shops?|flowers)\b/i, tags: [["shop", "florist"]], label: "Florist" },
  { re: /\b(tailors?|stitching)\b/i, tags: [["shop", "tailor"]], label: "Tailor" },
  { re: /\b(laundr(y|ies)|dry ?clean(ers?|ing)?|ironing)\b/i, tags: [["shop", "laundry"], ["shop", "dry_cleaning"]], label: "Laundry" },
  { re: /\b(salons?|barbers?|haircuts?|hair ?dressers?|beauty parlou?rs?|parlou?rs?|beauty)\b/i, tags: [["shop", "hairdresser"], ["shop", "beauty"]], label: "Salon" },
  { re: /\b(spas?|massage)\b/i, tags: [["shop", "massage"], ["leisure", "spa"], ["shop", "beauty"]], label: "Spa" },
  { re: /\b(gyms?|fitness|workout)\b/i, tags: [["leisure", "fitness_centre"]], label: "Gym" },
  { re: /\b(yoga)\b/i, tags: [["leisure", "fitness_centre"], ["amenity", "studio"]], label: "Yoga" },
  { re: /\b(swimming|swimming pools?|pools?)\b/i, tags: [["leisure", "swimming_pool"], ["leisure", "sports_centre"]], label: "Swimming" },
  { re: /\b(stadiums?|sports? (grounds?|centres?|centers?|complex)|turfs?|play ?grounds?)\b/i, tags: [["leisure", "stadium"], ["leisure", "sports_centre"], ["leisure", "playground"]], label: "Sports" },
  { re: /\b(parks?|gardens?)\b/i, tags: [["leisure", "park"], ["leisure", "garden"]], label: "Park" },
  { re: /\b(beach(es)?)\b/i, tags: [["natural", "beach"]], label: "Beach" },
  { re: /\b(zoos?)\b/i, tags: [["tourism", "zoo"]], label: "Zoo" },
  { re: /\b(museums?|galler(y|ies))\b/i, tags: [["tourism", "museum"], ["tourism", "gallery"]], label: "Museum" },
  { re: /\b(tourist|tourism|sightseeing|attractions?|places to (visit|see|go)|things to do|monuments?|forts?|viewpoints?|landmarks?)\b/i, tags: [["tourism", "attraction"], ["tourism", "viewpoint"], ["tourism", "museum"], ["historic", "monument"], ["historic", "fort"]], label: "Attraction" },
  { re: /\b(cinemas?|movies?|movie theat(er|re)s?|multiplex|theat(er|re)s?)\b/i, tags: [["amenity", "cinema"]], label: "Cinema" },
  { re: /\b(libraries|library)\b/i, tags: [["amenity", "library"]], label: "Library" },
  { re: /\b(post offices?)\b/i, tags: [["amenity", "post_office"]], label: "Post office" },
  { re: /\b(police( stations?)?)\b/i, tags: [["amenity", "police"]], label: "Police station" },
  { re: /\b(fire stations?)\b/i, tags: [["amenity", "fire_station"]], label: "Fire station" },
  { re: /\b(temples?|churches|church|mosques?|masjids?|gurudwaras?|gurdwaras?)\b/i, tags: [["amenity", "place_of_worship"]], label: "Place of worship" },
  { re: /\b(kindergartens?|play ?schools?|day ?cares?|creche)\b/i, tags: [["amenity", "kindergarten"], ["amenity", "childcare"]], label: "Kindergarten" },
  { re: /\b(schools?)\b/i, tags: [["amenity", "school"]], label: "School" },
  { re: /\b(colleges?|universit(y|ies))\b/i, tags: [["amenity", "college"], ["amenity", "university"]], label: "College" },
  { re: /\b(co-?working( spaces?)?)\b/i, tags: [["amenity", "coworking_space"], ["office", "coworking"]], label: "Coworking" },
  { re: /\b(wedding halls?|function halls?|marriage halls?|event (halls?|venues?)|banquet( halls?)?|kalyana mandapams?|convention (halls?|centres?|centers?))\b/i, tags: [["amenity", "events_venue"], ["amenity", "conference_centre"]], label: "Event venue" },
  { re: /\b(bus stops?|bus stations?|bus stands?|bus depots?)\b/i, tags: [["highway", "bus_stop"], ["amenity", "bus_station"]], label: "Bus stop" },
  { re: /\b(metro( stations?)?|railway stations?|train stations?|railway)\b/i, tags: [["railway", "station"]], label: "Station" },
  { re: /\b(airports?)\b/i, tags: [["aeroway", "aerodrome"]], label: "Airport" },
  { re: /\b(taxi( stands?)?|auto stands?|cab stands?)\b/i, tags: [["amenity", "taxi"]], label: "Taxi stand" },
  { re: /\b(parking)\b/i, tags: [["amenity", "parking"]], label: "Parking" },
  { re: /\b(toilets?|restrooms?|washrooms?|bathrooms?)\b/i, tags: [["amenity", "toilets"]], label: "Toilets" },
];

// "What's near me" / "anything near me": a mix of the places people usually
// mean. No label, so each place is named by its own tags.
const GENERAL = { tags: [["tourism", "attraction"], ["amenity", "restaurant"], ["amenity", "cafe"], ["leisure", "park"], ["shop", "mall"], ["tourism", "museum"]], label: null };

/** The OpenStreetMap kind for a query, or null when it isn't a place type. */
function kindFor(query) {
  return KINDS.find((k) => k.re.test(String(query || ""))) || null;
}

const GENERIC = /\b(places?|spots?|shops?|stores?|outlets?|centres?|centers?|near|me|nearby|nearest|closest|around|here|the|a|an|some|best|good|top|any|to|in|my|area|location)\b/gi;

// A specific name to look for when the query isn't a known kind: "dominos",
// "Third Wave Coffee", "decathlon". Null when nothing specific is left.
function nameTermFor(query) {
  const term = String(query || "").replace(GENERIC, " ").replace(/[^\p{L}\p{N}' &-]+/gu, " ").replace(/\s+/g, " ").trim();
  return term.length >= 2 ? term : null;
}

// Words worth ranking by within a kind: "biryani" among restaurants, "veg",
// "24 hours". The kind's own words ("restaurants") add nothing.
const KIND_WORDS = /\b(restaurants?|food|eat|eating|meals?|hotels?|caf[eé]s?|shops?|stores?|places?)\b/gi;
function preferTermsFor(query, kind) {
  if (!kind) return [];
  return String(query || "").replace(GENERIC, " ").replace(KIND_WORDS, " ").toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
}

const titleCase = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "chinese;indian" + restaurant → "Chinese restaurant"
function categoryOf(tags = {}, kind) {
  const cuisine = String(tags.cuisine || "").split(/[;,]/)[0].trim();
  if (tags.amenity === "fast_food") return cuisine ? `${titleCase(cuisine)} fast food` : "Fast food";
  if (cuisine && (tags.amenity === "restaurant" || tags.amenity === "cafe")) return `${titleCase(cuisine)} ${tags.amenity === "cafe" ? "café" : "restaurant"}`;
  if (tags.amenity === "food_court") return "Food court";
  if (tags.shop === "bakery") return "Bakery";
  if (tags.amenity === "clinic") return "Clinic";
  if (tags.amenity === "doctors") return "Doctor";
  if (tags.amenity === "pub") return "Pub";
  if (tags.tourism === "guest_house") return "Guest house";
  if (tags.tourism === "hostel") return "Hostel";
  if (tags.shop === "beauty") return "Beauty parlour";
  if (tags.shop === "hairdresser") return "Salon";
  if (kind?.label) return kind.label;
  return titleCase(tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.historic || tags.office || "Place");
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

const mapsUrlFor = (name, { lat, lng }) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat},${lng}`)}`;

// A user's words as an Overpass regex inside a QL string: regex specials are
// escaped (the backslash itself doubled for the string), and a trailing "s"
// may follow an apostrophe, so "dominos" finds "Domino's".
function overpassRegex(term) {
  const escaped = term.replace(/'/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&").replace(/"/g, '\\"');
  return /s$/i.test(escaped) ? `${escaped.slice(0, -1)}'?s` : escaped;
}

function overpassQuery({ kind, name }, { lat, lng }, radius, max = 150) {
  const around = `(around:${radius},${lat},${lng})`;
  const lines = kind
    ? kind.tags.map(([k, v]) => `nwr["${k}"="${v}"]["name"]${around};`).join("")
    : `nwr["name"~"${overpassRegex(name)}",i]${around};nwr["brand"~"${overpassRegex(name)}",i]["name"]${around};`;
  return `[out:json][timeout:12];(${lines});out center tags ${max};`;
}

// One query, tried on each Overpass mirror in turn.
async function overpassFetch(query) {
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      if (json?.remark && /runtime error|timed out|out of memory/i.test(json.remark) && !json.elements?.length) throw new Error(`Overpass: ${json.remark}`);
      return json.elements || [];
    } catch (err) {
      lastError = err;
      logger.warn("nearby.overpassFailed", { url, error: err.message });
    }
  }
  throw lastError || new Error("No Overpass server answered");
}

function placeFromElement(el, center, kind) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const tags = el.tags || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !tags.name) return null;
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
    cuisine: tags.cuisine || null,
    vegetarian: tags["diet:vegetarian"] === "only" ? "only" : tags["diet:vegetarian"] === "yes" ? "yes" : null,
    phone: tags.phone || tags["contact:phone"] || null,
    website: tags.website || tags["contact:website"] || null,
    photoRef: null,
    mapsUrl: mapsUrlFor(tags.name, location),
    source: "osm",
    distanceMeters: distanceMeters(center, location),
  };
}

// Nearest first, one entry per place (a branch can be mapped as both a node
// and a building), with places that match what was asked ("biryani", "veg")
// ahead of the rest.
function rankPlaces(places, prefer = []) {
  const seen = new Set();
  const unique = places.sort((a, b) => a.distanceMeters - b.distanceMeters).filter((p) => {
    const key = `${p.name.toLowerCase()}|${Math.round(p.location.lat * 2000)}|${Math.round(p.location.lng * 2000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!prefer.length) return unique;
  const matches = (p) => prefer.some((w) => {
    const text = `${p.name} ${p.cuisine || ""} ${p.category || ""}`.toLowerCase();
    if (/^(veg|vegetarian|pure)$/.test(w)) return !!p.vegetarian || /(?<!non[ -]?)\b(veg|vegetarian)\b/.test(text);
    return text.includes(w);
  });
  return [...unique.filter(matches), ...unique.filter((p) => !matches(p))];
}

/** Places matching `target` ({ kind } or { name }) near `center`. Throws when every mirror fails. */
async function searchOverpassTarget(target, center, { limit = 8, prefer = [] } = {}) {
  let found = [];
  for (const radius of RADII) {
    const elements = await overpassFetch(overpassQuery(target, center, radius));
    found = rankPlaces(elements.map((el) => placeFromElement(el, center, target.kind)).filter(Boolean), prefer);
    if (found.length >= ENOUGH) return { places: found.slice(0, limit), radius };
  }
  return { places: found.slice(0, limit), radius: RADII[RADII.length - 1] };
}

/** Places of `kind` near `center`, nearest first. Throws on network errors. */
async function searchOverpass(kind, center, opts = {}) {
  return (await searchOverpassTarget({ kind }, center, opts)).places;
}

// Photon ranks results by closeness to a point, so a free-text query finds
// nearby matches even when Overpass is down.
async function searchPhoton(query, center, { limit = 8 } = {}) {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}&limit=20&lang=en`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = await res.json();
  const places = (json.features || []).map((f) => {
    const p = f.properties || {};
    const [lng, lat] = f.geometry?.coordinates || [];
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (["place", "boundary", "highway", "landuse"].includes(p.osm_key)) return null;
    const location = { lat, lng };
    return {
      placeId: `osm:${({ N: "node", W: "way", R: "relation" })[p.osm_type] || "node"}/${p.osm_id}`,
      name: p.name,
      address: [[p.housenumber, p.street].filter(Boolean).join(" "), p.district || p.locality, p.city].filter(Boolean).join(", "),
      location, rating: null, reviews: null, openNow: null, hours: null,
      category: titleCase(p.osm_value || p.osm_key || "Place"),
      phone: null, website: null, photoRef: null,
      mapsUrl: mapsUrlFor(p.name, location),
      source: "osm",
      distanceMeters: distanceMeters(center, location),
    };
  }).filter((p) => p && p.distanceMeters <= FALLBACK_MAX_METERS);
  return rankPlaces(places).slice(0, limit);
}

// Last resort: Nominatim's text search inside a box around the user.
async function searchNominatim(query, center, { limit = 8 } = {}) {
  const d = 0.15; // ≈ 16 km
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", `${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}`);
  url.searchParams.set("bounded", "1");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json();
  const places = (Array.isArray(rows) ? rows : []).map((r) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    const name = r.name || String(r.display_name || "").split(",")[0];
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const location = { lat, lng };
    return {
      placeId: `osm:${r.osm_type}/${r.osm_id}`,
      name,
      address: String(r.display_name || "").split(",").slice(1, 4).join(",").trim(),
      location, rating: null, reviews: null, openNow: null, hours: null,
      category: titleCase(r.type || r.category || "Place"),
      phone: null, website: null, photoRef: null,
      mapsUrl: mapsUrlFor(name, location),
      source: "osm",
      distanceMeters: distanceMeters(center, location),
    };
  }).filter(Boolean);
  return rankPlaces(places).slice(0, limit);
}

/**
 * Everything "X near me" needs: Overpass by kind or by name, then Photon,
 * then Nominatim. Never throws. `failed` is true only when every service
 * errored — an empty list with failed=false really means nothing is near.
 */
async function findNearby(query, center, { limit = 8 } = {}) {
  const name = kindFor(query) ? null : nameTermFor(query);
  const kind = kindFor(query) || (name ? null : GENERAL);
  const prefer = preferTermsFor(query, kind);
  const text = (kind && kind.label) || name || (kind === GENERAL ? "tourist attraction" : String(query || "").trim());
  let errors = 0;
  let attempts = 0;

  if (kind || name) {
    attempts++;
    try {
      const { places, radius } = await searchOverpassTarget(kind ? { kind } : { name }, center, { limit, prefer });
      if (places.length) return { places, failed: false, source: "overpass", radius };
    } catch (err) {
      errors++;
      logger.warn("nearby.overpassUnavailable", { error: err.message });
    }
  }
  for (const search of [searchPhoton, searchNominatim]) {
    if (!text) break;
    attempts++;
    try {
      const places = await search(text, center, { limit });
      if (places.length) return { places, failed: false, source: search === searchPhoton ? "photon" : "nominatim", radius: FALLBACK_MAX_METERS };
    } catch (err) {
      errors++;
      logger.warn("nearby.fallbackFailed", { source: search.name, error: err.message });
    }
  }
  return { places: [], failed: attempts > 0 && errors === attempts, source: null, radius: RADII[RADII.length - 1] };
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

module.exports = {
  kindFor, nameTermFor, preferTermsFor, categoryOf, rankPlaces, overpassQuery,
  searchOverpass, searchPhoton, searchNominatim, findNearby, areaName, distanceMeters,
  OVERPASS_URLS, RADII,
};
