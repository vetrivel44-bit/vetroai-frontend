// What a "near me" place card shows: distance, how long it takes to get
// there, whether it is open now, and links for directions or a wider search.

export const formatDistance = (m) => (m == null ? "" : m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

// ~4.8 km/h on foot; city traffic for anything too far to walk.
export function travelTime(meters) {
  if (meters == null) return "";
  if (meters <= 2500) return `${Math.max(1, Math.round(meters / 80))} min walk`;
  return `${Math.max(1, Math.round(meters / 400))} min drive`;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const clock = (minutes) => {
  const h24 = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
};

// "Mo-Fr" → [1..5]; "Sa,Su" → [6, 0]; missing → every day.
function daysIn(spec) {
  if (!spec) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  for (const part of spec.split(",")) {
    const [a, b] = part.trim().split("-");
    const from = DAYS.indexOf(a);
    const to = b ? DAYS.indexOf(b) : from;
    if (from < 0 || to < 0) return null;
    for (let d = from; ; d = (d + 1) % 7) { out.add(d); if (d === to) break; }
  }
  return [...out];
}

/**
 * OpenStreetMap opening_hours → { open, label } at `now`, for the common forms
 * ("24/7", "Mo-Sa 09:00-21:00; Su off", "10:00-14:00,17:00-23:00",
 * "Mo-Su 18:00-02:00"). Null when the text is anything fancier.
 */
export function openingStatus(hours, now = new Date()) {
  const text = String(hours || "").trim();
  if (!text) return null;
  if (/^24\/7$/.test(text)) return { open: true, label: "Open 24 hours" };
  const rules = [];
  for (const raw of text.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(/^(?:([A-Z][a-z](?:-[A-Z][a-z])?(?:,[A-Z][a-z](?:-[A-Z][a-z])?)*)\s+)?(off|closed|\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*)$/);
    if (!m) return null;
    const days = daysIn(m[1]);
    if (!days) return null;
    const ranges = /^(off|closed)$/.test(m[2]) ? [] : m[2].split(",").map((r) => r.trim().split("-").map(toMinutes));
    rules.push({ days, ranges });
  }
  if (!rules.length) return null;
  // Later rules override earlier ones for the days they name.
  const rangesFor = (day) => {
    let ranges = null;
    for (const r of rules) if (r.days.includes(day)) ranges = r.ranges;
    return ranges || [];
  };
  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  // Open in one of today's ranges, or in last night's range that runs past midnight.
  for (const [start, end] of rangesFor(day)) {
    const close = end <= start ? end + 1440 : end;
    if (minute >= start && minute < close) return { open: true, label: `Open · closes ${clock(close)}` };
  }
  for (const [start, end] of rangesFor((day + 6) % 7)) {
    if (end <= start && minute < end) return { open: true, label: `Open · closes ${clock(end)}` };
  }
  const later = rangesFor(day).map(([start]) => start).filter((start) => start > minute).sort((a, b) => a - b)[0];
  if (later != null) return { open: false, label: `Closed · opens ${clock(later)}` };
  for (let i = 1; i <= 7; i++) {
    const next = rangesFor((day + i) % 7).map(([start]) => start).sort((a, b) => a - b)[0];
    if (next != null) return { open: false, label: `Closed · opens ${i === 1 ? "" : `${DAYS[(day + i) % 7]} `}${clock(next)}` };
  }
  return { open: false, label: "Closed" };
}

/** Open/closed for a place: Google's openNow when present, else its hours. */
export function placeStatus(place, now = new Date()) {
  if (place?.openNow === true) return { open: true, label: "Open now" };
  if (place?.openNow === false) return { open: false, label: "Closed now" };
  return openingStatus(place?.hours, now);
}

export function directionsUrl(center, place) {
  const to = place.location;
  const mode = place.distanceMeters != null && place.distanceMeters <= 1500 ? "walking" : "driving";
  const params = new URLSearchParams({ api: "1", destination: `${to.lat},${to.lng}`, travelmode: mode });
  if (center) params.set("origin", `${center.lat},${center.lng}`);
  if (place.placeId && !String(place.placeId).startsWith("osm:")) params.set("destination_place_id", place.placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}

/** The same search in Google Maps, around the user. */
export function mapsSearchUrl(subject, center) {
  const what = encodeURIComponent(String(subject || "places").trim() || "places");
  return center ? `https://www.google.com/maps/search/${what}/@${center.lat},${center.lng},15z` : `https://www.google.com/maps/search/${what}`;
}

export function websiteUrl(site) {
  const s = String(site || "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export function phoneUrl(phone) {
  const first = String(phone || "").split(/[;,/]/)[0].replace(/[^\d+]/g, "");
  return first.length >= 6 ? `tel:${first}` : null;
}

// The road route between two points, from the public OSRM router: GeoJSON
// coordinates, metres and seconds. Null when it can't be had.
export async function fetchRoute(from, to, { fetchImpl = globalThis.fetch, signal } = {}) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetchImpl(url, { signal: signal || AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const route = (await res.json())?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length > 1 ? { coords, meters: route.distance, seconds: route.duration } : null;
  } catch {
    return null;
  }
}

export const driveTime = (seconds) => {
  const mins = Math.max(1, Math.round(seconds / 60));
  return mins < 60 ? `${mins} min drive` : `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min ` : ""}drive`;
};
