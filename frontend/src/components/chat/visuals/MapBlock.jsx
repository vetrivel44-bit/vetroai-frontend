import React, { useContext, useEffect, useMemo, useRef } from "react";
import { MapPin } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";

// A ```json map block: [{ "name", "lat", "lng", "notes" }, …] shown on a
// Leaflet map with free OpenStreetMap tiles (no API key). Leaflet and its
// CSS load the first time a map appears.

let leafletModule = null;
const loadLeaflet = () => (leafletModule ||= Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([m]) => m.default || m));

function parsePlaces(code) {
  let data = JSON.parse(code);
  if (!Array.isArray(data)) data = data?.places || data?.locations || data?.results;
  if (!Array.isArray(data) || !data.length) throw new Error("expected an array of places");
  const places = data.map((p) => ({
    name: String(p?.name ?? p?.title ?? "").trim() || "Place",
    notes: String(p?.notes ?? p?.description ?? "").trim(),
    lat: Number(p?.lat ?? p?.latitude),
    lng: Number(p?.lng ?? p?.lon ?? p?.longitude),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  if (!places.length) throw new Error("no valid coordinates");
  return places;
}

// Popup built from DOM text nodes — place names and notes come from the
// model and must never be interpreted as HTML.
function popupContent(place) {
  const box = document.createElement("div");
  box.className = "vetro-map-popup";
  const name = document.createElement("strong");
  name.textContent = place.name;
  box.appendChild(name);
  if (place.notes) {
    const notes = document.createElement("span");
    notes.textContent = place.notes;
    box.appendChild(notes);
  }
  return box;
}

export default function MapBlock({ code, fallback }) {
  const pending = isStillStreaming(useContext(OpenBlockContext), code);
  const containerRef = useRef(null);
  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { places: parsePlaces(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  useEffect(() => {
    if (!parsed?.places || !containerRef.current) return undefined;
    let map = null;
    let alive = true;
    loadLeaflet().then((L) => {
      if (!alive || !containerRef.current) return;
      map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      const points = parsed.places.map((place) => {
        L.circleMarker([place.lat, place.lng], { radius: 8, weight: 2, color: "#FFFFFF", fillColor: "#E0703A", fillOpacity: 1 })
          .addTo(map)
          .bindPopup(popupContent(place))
          .bindTooltip(place.name, { direction: "top", offset: [0, -8] });
        return [place.lat, place.lng];
      });
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
    });
    return () => { alive = false; map?.remove(); };
  }, [parsed]);

  if (pending) return <VisualPending icon={MapPin} label="Loading map…" />;
  if (parsed?.error) return <VisualFallback what="map" error={parsed.error} fallback={fallback} />;
  const places = parsed?.places || [];
  return (
    <VisualCard icon={MapPin} title={`Map · ${places.length} place${places.length === 1 ? "" : "s"}`} code={code}>
      <div className="vetro-map-body"><div ref={containerRef} style={{ width: "100%", height: "100%" }} /></div>
      <ul className="vetro-map-list">
        {places.map((p, i) => <li key={i}>{p.name}</li>)}
      </ul>
    </VisualCard>
  );
}
