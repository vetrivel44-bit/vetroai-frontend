const ApiError = require("../utils/apiError");
const { config } = require("../config/env");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
const USE_GOOGLE = Boolean(GOOGLE_MAPS_API_KEY);

const safeFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `External map service error (${res.status}): ${text}`);
  }
  return res.json();
};

const buildGooglePhotoUrl = (photoReference, maxWidth = 400) => {
  if (!photoReference) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${encodeURIComponent(photoReference)}&key=${GOOGLE_MAPS_API_KEY}`;
};

const distanceBetween = (lat1, lng1, lat2, lng2) => {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number" || Number.isNaN(v))) return null;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

const buildOsmMapUrl = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
const buildGoogleMapsUrl = (placeId, lat, lng, name) => {
  if (placeId) return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  if (lat && lng) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name || "Location"}`)}&query_place_id=${encodeURIComponent(`${lat},${lng}`)}`;
  return "https://maps.google.com";
};

const formatPlace = (raw, userLocation = null) => {
  if (!raw) return null;
  const lat = raw.geometry?.location?.lat ?? raw.lat ?? raw.latitude ?? raw.lat;
  const lng = raw.geometry?.location?.lng ?? raw.lon ?? raw.longitude ?? raw.lng;
  const distance = userLocation && lat && lng
    ? distanceBetween(userLocation.lat, userLocation.lng, Number(lat), Number(lng))
    : null;

  return {
    placeId: raw.place_id || raw.osm_id || null,
    name: raw.name || raw.display_name || raw.structured_formatting?.main_text || raw.formatted_address || "Unknown location",
    address: raw.formatted_address || raw.vicinity || raw.display_name || raw.address || "",
    location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
    rating: raw.rating || null,
    reviews: raw.user_ratings_total || raw.review_count || null,
    openNow: raw.opening_hours?.open_now ?? raw.opening_hours?.is_open ?? null,
    photoUrl: raw.photos?.length ? buildGooglePhotoUrl(raw.photos[0].photo_reference || raw.photos[0].photo_reference) : null,
    mapsUrl: USE_GOOGLE ? buildGoogleMapsUrl(raw.place_id, lat, lng, raw.name) : (lat && lng ? buildOsmMapUrl(lat, lng) : null),
    source: USE_GOOGLE ? "google" : "osm",
    types: raw.types || [],
    distanceMeters: distance,
  };
};

const getSearchType = (query = "") => {
  const normalized = String(query).toLowerCase();
  if (normalized.includes("restaurant")) return "restaurant";
  if (normalized.includes("cafe") || normalized.includes("coffee")) return "cafe";
  if (normalized.includes("hospital")) return "hospital";
  if (normalized.includes("mall")) return "shopping_mall";
  if (normalized.includes("hotel")) return "lodging";
  if (normalized.includes("atm")) return "atm";
  if (normalized.includes("petrol") || normalized.includes("gas station") || normalized.includes("fuel")) return "gas_station";
  if (normalized.includes("pharmacy") || normalized.includes("chemist")) return "pharmacy";
  return null;
};

const ensureValidQuery = (query) => String(query || "").trim();

const searchPlaces = async (req, res) => {
  const query = ensureValidQuery(req.query.query || req.query.text);
  const type = ensureValidQuery(req.query.type);
  const lat = req.query.lat ? Number(req.query.lat) : null;
  const lng = req.query.lng ? Number(req.query.lng) : null;
  const radius = Number(req.query.radius || 5000);
  const limit = Math.min(Number(req.query.limit || 6), 12);
  if (!query && !type) throw new ApiError(400, "Query or type is required for place search.");

  const useType = type || getSearchType(query);
  const userLocation = lat && lng ? { lat, lng } : null;

  if (USE_GOOGLE) {
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query || useType || "places");
    if (userLocation) {
      searchUrl.searchParams.set("location", `${lat},${lng}`);
      searchUrl.searchParams.set("radius", String(radius));
    }
    if (useType) searchUrl.searchParams.set("type", useType);
    searchUrl.searchParams.set("key", GOOGLE_MAPS_API_KEY);

    const searchResult = await safeFetch(searchUrl.toString());
    const places = (searchResult.results || []).slice(0, limit);
    const formatted = places.map((item) => formatPlace(item, userLocation));

    const detailPromises = formatted.map(async (place) => {
      if (!place.placeId) return place;
      const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailUrl.searchParams.set("place_id", place.placeId);
      detailUrl.searchParams.set("fields", "name,formatted_address,geometry,opening_hours,rating,user_ratings_total,photos,website,formatted_phone_number,types");
      detailUrl.searchParams.set("key", GOOGLE_MAPS_API_KEY);
      const detailResult = await safeFetch(detailUrl.toString());
      const detail = detailResult.result || {};
      return {
        ...place,
        name: detail.name || place.name,
        address: detail.formatted_address || place.address,
        location: detail.geometry?.location || place.location,
        rating: detail.rating ?? place.rating,
        reviews: detail.user_ratings_total ?? place.reviews,
        openNow: detail.opening_hours?.open_now ?? place.openNow,
        photoUrl: detail.photos?.length ? buildGooglePhotoUrl(detail.photos[0].photo_reference) : place.photoUrl,
        website: detail.website || null,
        phone: detail.formatted_phone_number || null,
      };
    });

    const detailed = await Promise.all(detailPromises);
    return res.json({ success: true, data: detailed });
  }

  // Fallback to OpenStreetMap / Nominatim when no Google API key is configured.
  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("format", "json");
  
  // Append India to query if not present for better regional results
  let searchQ = query || useType;
  if (searchQ && !searchQ.toLowerCase().includes("india")) {
    searchQ += ", India";
  }
  
  nominatimUrl.searchParams.set("q", searchQ);
  nominatimUrl.searchParams.set("countrycodes", "in"); // Restrict results specifically to India
  nominatimUrl.searchParams.set("addressdetails", "1");
  nominatimUrl.searchParams.set("limit", String(limit));
  if (userLocation) {
    nominatimUrl.searchParams.set("viewbox", `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`);
    nominatimUrl.searchParams.set("bounded", "1");
  }

  const searchResult = await safeFetch(nominatimUrl.toString(), { headers: { "User-Agent": "VetroAI-Maps/1.0" } });
  const formatted = (searchResult || []).slice(0, limit).map((item) => formatPlace(item, userLocation));
  return res.json({ success: true, data: formatted });
};

const placeDetails = async (req, res) => {
  const placeId = ensureValidQuery(req.query.placeId);
  const lat = req.query.lat ? Number(req.query.lat) : null;
  const lng = req.query.lng ? Number(req.query.lng) : null;
  if (!placeId && (!lat || !lng)) throw new ApiError(400, "placeId or coordinates are required.");

  const userLocation = lat && lng ? { lat, lng } : null;
  if (USE_GOOGLE && placeId) {
    const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailUrl.searchParams.set("place_id", placeId);
    detailUrl.searchParams.set("fields", "name,formatted_address,geometry,opening_hours,rating,user_ratings_total,photos,website,formatted_phone_number,types");
    detailUrl.searchParams.set("key", GOOGLE_MAPS_API_KEY);
    const detailResult = await safeFetch(detailUrl.toString());
    const place = formatPlace(detailResult.result || {}, userLocation);
    return res.json({ success: true, data: place });
  }

  if (!USE_GOOGLE && userLocation) {
    const osmUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    osmUrl.searchParams.set("format", "json");
    osmUrl.searchParams.set("lat", String(lat));
    osmUrl.searchParams.set("lon", String(lng));
    osmUrl.searchParams.set("addressdetails", "1");
    const detailResult = await safeFetch(osmUrl.toString(), { headers: { "User-Agent": "VetroAI-Maps/1.0" } });
    const place = formatPlace(detailResult || {}, userLocation);
    return res.json({ success: true, data: place });
  }

  return res.json({ success: true, data: null });
};

const getDirections = async (req, res) => {
  const originLat = Number(req.query.originLat);
  const originLng = Number(req.query.originLng);
  const destLat = Number(req.query.destLat);
  const destLng = Number(req.query.destLng);
  const mode = String(req.query.mode || "driving").toLowerCase();
  if (!originLat || !originLng || !destLat || !destLng) throw new ApiError(400, "originLat, originLng, destLat, and destLng are required.");

  if (USE_GOOGLE) {
    const directionsUrl = new URL("https://maps.googleapis.com/maps/api/directions/json");
    directionsUrl.searchParams.set("origin", `${originLat},${originLng}`);
    directionsUrl.searchParams.set("destination", `${destLat},${destLng}`);
    directionsUrl.searchParams.set("mode", mode);
    directionsUrl.searchParams.set("key", GOOGLE_MAPS_API_KEY);
    const directions = await safeFetch(directionsUrl.toString());
    const route = directions.routes?.[0] || null;
    const leg = route?.legs?.[0] || null;
    return res.json({
      success: true,
      data: {
        summary: route?.summary || null,
        distance: leg?.distance?.text || null,
        duration: leg?.duration?.text || null,
        steps: leg?.steps?.map((step) => ({ html_instructions: step.html_instructions, distance: step.distance?.text, duration: step.duration?.text })) || [],
        mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=${mode}`,
      },
    });
  }

  const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_${mode === "walking" ? "foot" : mode === "bicycling" ? "bike" : "car"}&route=${originLat}%2C${originLng}%3B${destLat}%2C${destLng}`;
  return res.json({
    success: true,
    data: {
      summary: null,
      distance: null,
      duration: null,
      steps: [],
      mapsUrl: osmUrl,
    },
  });
};

module.exports = { searchPlaces, placeDetails, getDirections };
