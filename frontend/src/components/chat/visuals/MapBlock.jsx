import React, { useContext, useEffect, useMemo, useRef } from "react";
import { MapPin } from "lucide-react";
import VisualCard, { VisualFallback, VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { loadMapTiler, streetStyle } from "../../../lib/maptiler";
import { useDocumentTheme } from "./useDocumentTheme";

// A ```json map block: [{ "name", "lat", "lng", "notes" }, …] shown on a
// MapTiler map — the same provider as the app's other maps. The SDK loads the
// first time a map appears.

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
  const theme = useDocumentTheme();
  const containerRef = useRef(null);
  const parsed = useMemo(() => {
    if (pending) return null;
    try { return { places: parsePlaces(code) }; } catch (err) { return { error: String(err.message || err).split("\n")[0] }; }
  }, [code, pending]);

  useEffect(() => {
    if (!parsed?.places || !containerRef.current) return undefined;
    let map = null;
    let alive = true;
    loadMapTiler().then((sdk) => {
      if (!alive || !containerRef.current) return;
      const points = parsed.places.map((p) => [p.lng, p.lat]);
      map = new sdk.Map({
        container: containerRef.current,
        style: streetStyle(sdk, theme),
        center: points[0],
        zoom: 14,
        navigationControl: true,
        geolocateControl: false,
        cooperativeGestures: true, // scrolling the chat doesn't zoom the map
      });
      parsed.places.forEach((place) => {
        new sdk.Marker({ color: "#E0703A" })
          .setLngLat([place.lng, place.lat])
          .setPopup(new sdk.Popup({ offset: 28 }).setDOMContent(popupContent(place)))
          .addTo(map);
      });
      if (points.length > 1) {
        const lngs = points.map((p) => p[0]);
        const lats = points.map((p) => p[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 16, duration: 0 });
      }
    }).catch(() => {}); // the SDK didn't load — the card still lists the places
    return () => { alive = false; map?.remove(); };
  }, [parsed, theme]);

  if (pending) return <VisualPending icon={MapPin} label="Loading map…" />;
  if (parsed?.error) return <VisualFallback what="map" error={parsed.error} fallback={fallback} />;
  const places = parsed?.places || [];
  return (
    <VisualCard icon={MapPin} title={`Map · ${places.length} place${places.length === 1 ? "" : "s"}`} code={code}>
      <div className="vetro-map-body"><div ref={containerRef} className="vetro-map-canvas" /></div>
      <ul className="vetro-map-list">
        {places.map((p, i) => <li key={i}>{p.name}</li>)}
      </ul>
    </VisualCard>
  );
}
