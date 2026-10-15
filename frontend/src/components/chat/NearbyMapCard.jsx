import React, { useEffect, useMemo, useRef, useState } from "react";
import { BedDouble, Coffee, ExternalLink, HeartPulse, MapPin, Navigation, Star, Utensils } from "lucide-react";
import { loadMapTiler, streetStyle } from "../../lib/maptiler";
import { useDocumentTheme } from "./visuals/useDocumentTheme";
import "./NearbyMapCard.css";

// The answer to "restaurants near me": a map with where you are and the
// places around you, a row of place cards to swipe through (the map follows),
// and a button for directions to the one you're looking at.
//
// `data` = { title, center: {lat, lng}, places: [{ name, location, rating,
// reviews, category, distanceMeters, photoUrl, mapsUrl, placeId, openNow }] }

const formatDistance = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

function CategoryIcon({ category }) {
  const c = String(category || "").toLowerCase();
  if (/caf|coffee|bakery|tea/.test(c)) return <Coffee size={22} />;
  if (/restaurant|food|dining|diner|bar|pub|meal/.test(c)) return <Utensils size={22} />;
  if (/hospital|clinic|doctor|pharmac|health/.test(c)) return <HeartPulse size={22} />;
  if (/hotel|lodg|guest|hostel/.test(c)) return <BedDouble size={22} />;
  return <MapPin size={22} />;
}

function directionsUrl(center, place) {
  const to = place.location;
  const mode = place.distanceMeters != null && place.distanceMeters <= 1500 ? "walking" : "driving";
  const params = new URLSearchParams({ api: "1", destination: `${to.lat},${to.lng}`, travelmode: mode });
  if (center) params.set("origin", `${center.lat},${center.lng}`);
  if (place.placeId && !String(place.placeId).startsWith("osm:")) params.set("destination_place_id", place.placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}

// The map positions a marker with a transform on its element, so the pin
// that grows when selected is a child of it, not the element itself.
function pinElement(name, selected) {
  const wrap = document.createElement("div");
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = `nearby-pin${selected ? " is-selected" : ""}`;
  pin.setAttribute("aria-label", name);
  pin.innerHTML = '<svg viewBox="0 0 32 42" width="30" height="40" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z"/><circle cx="16" cy="15.5" r="5.5"/></svg>';
  wrap.appendChild(pin);
  return { wrap, pin };
}

export default function NearbyMapCard({ data }) {
  const theme = useDocumentTheme();
  const places = useMemo(() => (data?.places || []).filter((p) => p?.location && Number.isFinite(p.location.lat) && Number.isFinite(p.location.lng)), [data]);
  const center = data?.center || null;
  const [selected, setSelected] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const pinsRef = useRef([]);
  const railRef = useRef(null);
  const selectedRef = useRef(0);

  // Build the map once per answer (and per theme).
  useEffect(() => {
    if (!places.length || !mapEl.current) return undefined;
    let map = null;
    let alive = true;
    loadMapTiler().then((sdk) => {
      if (!alive || !mapEl.current) return;
      const points = places.map((p) => [p.location.lng, p.location.lat]);
      if (center) points.push([center.lng, center.lat]);
      map = new sdk.Map({
        container: mapEl.current,
        style: streetStyle(sdk, theme),
        center: points[0],
        zoom: 15,
        navigationControl: false,
        geolocateControl: false,
        attributionControl: false,
        cooperativeGestures: true,
      });
      mapRef.current = map;
      if (center) {
        const me = document.createElement("div");
        me.className = "nearby-me";
        me.setAttribute("aria-label", "You are here");
        new sdk.Marker({ element: me }).setLngLat([center.lng, center.lat]).addTo(map);
      }
      pinsRef.current = places.map((place, i) => {
        const { wrap, pin: el } = pinElement(place.name, i === selectedRef.current);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const card = railRef.current?.children[i];
          card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          setSelected(i);
        });
        new sdk.Marker({ element: wrap, anchor: "bottom" }).setLngLat([place.location.lng, place.location.lat]).addTo(map);
        return el;
      });
      if (points.length > 1) {
        const lngs = points.map((p) => p[0]);
        const lats = points.map((p) => p[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
          padding: { top: 64, left: 40, right: 40, bottom: 150 }, maxZoom: 16, duration: 0,
        });
      }
    }).catch(() => { if (alive) setMapFailed(true); });
    return () => { alive = false; map?.remove(); mapRef.current = null; pinsRef.current = []; };
  }, [places, center, theme]);

  // Follow the selected card on the map.
  useEffect(() => {
    selectedRef.current = selected;
    pinsRef.current.forEach((el, i) => el.classList.toggle("is-selected", i === selected));
    const place = places[selected];
    if (place && mapRef.current) mapRef.current.easeTo({ center: [place.location.lng, place.location.lat], duration: 450, offset: [0, -50] });
  }, [selected, places]);

  // The card nearest the middle of the rail is the selected one.
  const onRailScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const mid = rail.scrollLeft + rail.clientWidth / 2;
    let best = 0;
    let bestGap = Infinity;
    Array.from(rail.children).forEach((card, i) => {
      const gap = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
      if (gap < bestGap) { bestGap = gap; best = i; }
    });
    if (best !== selectedRef.current) setSelected(best);
  };

  if (!places.length) return null;
  const current = places[selected] || places[0];

  return (
    <div className={`nearby-card not-prose${mapFailed ? " no-map" : ""}`}>
      <div className="nearby-head"><MapPin size={17} /> <span>{data.title}</span></div>
      <div className="nearby-body">
        {!mapFailed && <div ref={mapEl} className="nearby-map" />}
        <div className="nearby-rail" ref={railRef} onScroll={onRailScroll}>
          {places.map((place, i) => (
            <div key={`${place.name}-${i}`} className={`nearby-place${i === selected ? " is-selected" : ""}`} onClick={() => setSelected(i)}>
              <div className="nearby-thumb">
                {place.photoUrl ? <img src={place.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
                <CategoryIcon category={place.category} />
              </div>
              <div className="nearby-info">
                <strong>{place.name}</strong>
                <span className="nearby-meta">
                  {place.rating ? <><b>{Number(place.rating).toFixed(1)}</b> <Star size={12} fill="currentColor" />{place.reviews ? <> ({place.reviews})</> : null} · </> : null}
                  {place.category || "Place"}
                </span>
                <span className="nearby-sub">
                  {[formatDistance(place.distanceMeters), place.openNow === true ? "Open now" : place.openNow === false ? "Closed now" : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
              {place.mapsUrl && (
                <a className="nearby-open" href={place.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${place.name} in Google Maps`} onClick={(e) => e.stopPropagation()}>
                  <ExternalLink size={18} />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
      <a className="nearby-route" href={directionsUrl(center, current)} target="_blank" rel="noopener noreferrer">
        <Navigation size={16} /> Open route in maps
      </a>
    </div>
  );
}
