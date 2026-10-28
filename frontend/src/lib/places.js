// The places to pin on a "location" map block. The map only read `points`,
// but models also list them as `highlights`, `places`, `locations` or
// `markers`, under `name` instead of `label`: "best tourist places in Tamil
// Nadu" drew one pin for the state and dropped all 19 places. Places with the
// same name or the same spot (Kanyakumari, three times) are pinned once.

const LISTS = ["points", "highlights", "places", "locations", "markers", "spots", "attractions"];

const num = (v) => (v === "" || v == null ? NaN : Number(v));

export function placePoints(data) {
  if (!data || typeof data !== "object") return [];
  const raw = LISTS.flatMap((key) => (Array.isArray(data[key]) ? data[key] : []));
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const lat = num(p.lat ?? p.latitude ?? p.coordinates?.lat);
    const lng = num(p.lng ?? p.lon ?? p.longitude ?? p.coordinates?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const label = String(p.label ?? p.name ?? p.title ?? "").trim();
    const nameKey = label.toLowerCase();
    const spotKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if ((nameKey && seen.has(`n:${nameKey}`)) || seen.has(`s:${spotKey}`)) continue;
    if (nameKey) seen.add(`n:${nameKey}`);
    seen.add(`s:${spotKey}`);
    out.push({ ...p, lat, lng, label, note: p.note ?? p.notes ?? p.description ?? "" });
  }
  return out;
}
