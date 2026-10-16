import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BedDouble, Coffee, ExternalLink, Fuel, Globe, HeartPulse, Landmark, MapPin, MapPinOff, Navigation,
  Phone, Pill, Scissors, ShoppingBag, Star, TreePine, Utensils, WifiOff,
} from "lucide-react";
import { loadMapTiler, streetStyle } from "../../lib/maptiler";
import { directionsUrl, formatDistance, mapsSearchUrl, phoneUrl, placeStatus, travelTime, websiteUrl } from "../../lib/nearbyFormat";
import { useDocumentTheme } from "./visuals/useDocumentTheme";
import "./NearbyMapCard.css";

// The answer to "restaurants near me": a map with where you are and numbered
// pins, the same numbers on a list of places (nearest first) with distance,
// walking time, open/closed and buttons for directions, calling and the
// website. When nothing was found, or the map services were down, it says so
// and offers the same search in Google Maps.
//
// `data` = { title, subject, area, radiusKm, status: "ok" | "empty" | "failed",
//   center: {lat, lng}, places: [{ name, location, rating, reviews, category,
//   distanceMeters, photoUrl, mapsUrl, placeId, openNow, hours, phone, website,
//   source }] }

function CategoryIcon({ category, size = 18 }) {
  const c = String(category || "").toLowerCase();
  if (/caf|coffee|bakery|tea|ice cream|sweet/.test(c)) return <Coffee size={size} />;
  if (/restaurant|food|dining|diner|bar|pub|meal|court/.test(c)) return <Utensils size={size} />;
  if (/pharmac|chemist/.test(c)) return <Pill size={size} />;
  if (/hospital|clinic|doctor|health|dentist|vet/.test(c)) return <HeartPulse size={size} />;
  if (/hotel|lodg|guest|hostel|motel/.test(c)) return <BedDouble size={size} />;
  if (/fuel|petrol|charging/.test(c)) return <Fuel size={size} />;
  if (/salon|beauty|spa|barber/.test(c)) return <Scissors size={size} />;
  if (/mall|shop|store|grocery|market|clothes|electronics/.test(c)) return <ShoppingBag size={size} />;
  if (/park|garden|beach|zoo/.test(c)) return <TreePine size={size} />;
  if (/attraction|museum|monument|fort|worship|temple|viewpoint/.test(c)) return <Landmark size={size} />;
  return <MapPin size={size} />;
}

// A numbered pin. The map positions a marker with a transform on its
// element, so the part that grows when selected is a child of it.
function pinElement(number, name, selected, delay) {
  const wrap = document.createElement("div");
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = `nearby-pin${selected ? " is-selected" : ""}`;
  pin.style.animationDelay = `${delay}ms`;
  pin.setAttribute("aria-label", `${number}. ${name}`);
  pin.innerHTML = `<svg viewBox="0 0 32 42" width="30" height="40" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z"/></svg><span>${number}</span>`;
  wrap.appendChild(pin);
  return { wrap, pin };
}

function EmptyState({ data }) {
  const failed = data.status === "failed";
  return (
    <div className="nearby-empty">
      <span className="nearby-empty-icon">{failed ? <WifiOff size={22} /> : <MapPinOff size={22} />}</span>
      <p className="nearby-empty-title">{failed ? "The map search didn't respond" : `No ${String(data.subject || "places").toLowerCase()} found nearby`}</p>
      <p className="nearby-empty-sub">
        {failed
          ? "The map services are busy right now. Try again in a moment, or search in Google Maps."
          : `Nothing like that is mapped within about ${data.radiusKm || 15} km of you. Google Maps may know more.`}
      </p>
    </div>
  );
}

export default function NearbyMapCard({ data }) {
  const theme = useDocumentTheme();
  const places = useMemo(() => (data?.places || []).filter((p) => p?.location && Number.isFinite(p.location.lat) && Number.isFinite(p.location.lng)), [data]);
  const center = data?.center || null;
  const [selected, setSelected] = useState(0);
  const [mapState, setMapState] = useState("loading"); // loading | ready | failed
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const pinsRef = useRef([]);
  const listRef = useRef(null);
  const selectedRef = useRef(0);
  const searchUrl = mapsSearchUrl(data?.subject || data?.title, center);

  // Build the map once per answer (and per theme).
  useEffect(() => {
    if (!places.length || !mapEl.current) return undefined;
    let map = null;
    let alive = true;
    const fail = () => { if (alive) setMapState("failed"); };
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
      // A rejected key or blocked tiles used to leave a blank grey box; until
      // the map has drawn, an error means falling back to the list alone.
      let loaded = false;
      map.on("load", () => { loaded = true; if (alive) setMapState("ready"); });
      map.on("error", () => { if (!loaded) fail(); });
      setTimeout(() => { if (!loaded) fail(); }, 12000);
      if (center) {
        const me = document.createElement("div");
        me.className = "nearby-me";
        me.setAttribute("aria-label", "You are here");
        me.innerHTML = "<span></span>";
        new sdk.Marker({ element: me }).setLngLat([center.lng, center.lat]).addTo(map);
      }
      pinsRef.current = places.map((place, i) => {
        const { wrap, pin: el } = pinElement(i + 1, place.name, i === selectedRef.current, 120 + i * 70);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          listRef.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          setSelected(i);
        });
        new sdk.Marker({ element: wrap, anchor: "bottom" }).setLngLat([place.location.lng, place.location.lat]).addTo(map);
        return el;
      });
      if (points.length > 1) {
        const lngs = points.map((p) => p[0]);
        const lats = points.map((p) => p[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
          padding: { top: 56, left: 44, right: 44, bottom: 44 }, maxZoom: 16, duration: 0,
        });
      }
    }).catch(fail);
    return () => { alive = false; map?.remove(); mapRef.current = null; pinsRef.current = []; };
  }, [places, center, theme]);

  // The map follows the selected place.
  useEffect(() => {
    selectedRef.current = selected;
    pinsRef.current.forEach((el, i) => el.classList.toggle("is-selected", i === selected));
    const place = places[selected];
    if (place && mapRef.current) mapRef.current.easeTo({ center: [place.location.lng, place.location.lat], duration: 450 });
  }, [selected, places]);

  const select = (i) => setSelected(i);
  const recenter = () => {
    if (!mapRef.current || !center) return;
    const pts = [...places.map((p) => [p.location.lng, p.location.lat]), [center.lng, center.lat]];
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 50, maxZoom: 16, duration: 500 });
  };

  if (!data) return null;
  const showMap = places.length > 0 && mapState !== "failed";
  const fromOsm = places.some((p) => p.source === "osm");

  return (
    <section className={`nearby-card not-prose${showMap ? "" : " no-map"}`} aria-label={data.title}>
      <header className="nearby-head">
        <span className="nearby-head-icon"><CategoryIcon category={places[0]?.category || data.subject} size={17} /></span>
        <span className="nearby-head-text">
          <strong>{data.title}</strong>
          <small>{places.length ? `${places.length} place${places.length === 1 ? "" : "s"} · nearest first` : data.status === "failed" ? "Search unavailable" : "Nothing nearby"}</small>
        </span>
        <a className="nearby-head-link" href={searchUrl} target="_blank" rel="noopener noreferrer" title="Search in Google Maps" aria-label="Search in Google Maps">
          <ExternalLink size={14} /><span>Google Maps</span>
        </a>
      </header>

      {places.length === 0 ? <EmptyState data={data} /> : (
        <div className="nearby-body">
          {showMap && (
            <div className={`nearby-map-wrap${mapState === "ready" ? " is-ready" : ""}`}>
              <div ref={mapEl} className="nearby-map" />
              {center && mapState === "ready" && (
                <button type="button" className="nearby-recenter" onClick={recenter} aria-label="Show all places"><Navigation size={15} /></button>
              )}
            </div>
          )}
          <ol className="nearby-list" ref={listRef}>
            {places.map((place, i) => {
              const status = placeStatus(place);
              const tel = phoneUrl(place.phone);
              const site = websiteUrl(place.website);
              return (
                <li
                  key={`${place.name}-${i}`}
                  className={`nearby-place${i === selected ? " is-selected" : ""}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  onClick={() => select(i)}
                >
                  <span className="nearby-num" aria-hidden="true">{i + 1}</span>
                  <div className="nearby-info">
                    <strong title={place.name}>{place.name}</strong>
                    <span className="nearby-meta">
                      {place.rating ? <span className="nearby-rating"><Star size={12} fill="currentColor" /> {Number(place.rating).toFixed(1)}{place.reviews ? <em> ({place.reviews})</em> : null}</span> : null}
                      <span>{place.category || "Place"}</span>
                    </span>
                    <span className="nearby-sub">
                      {place.distanceMeters != null && <span>{formatDistance(place.distanceMeters)} · {travelTime(place.distanceMeters)}</span>}
                      {status && <span className={status.open ? "is-open" : "is-closed"}>{status.label}</span>}
                    </span>
                    <span className="nearby-actions" onClick={(e) => e.stopPropagation()}>
                      <a className="is-primary" href={directionsUrl(center, place)} target="_blank" rel="noopener noreferrer"><Navigation size={13} /> Directions</a>
                      {tel && <a href={tel}><Phone size={13} /> Call</a>}
                      {site && <a href={site} target="_blank" rel="noopener noreferrer"><Globe size={13} /> Website</a>}
                    </span>
                  </div>
                  {place.photoUrl && (
                    <img className="nearby-photo" src={place.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <footer className="nearby-foot">
        {places.length ? (
          <a className="nearby-cta" href={directionsUrl(center, places[selected] || places[0])} target="_blank" rel="noopener noreferrer">
            <Navigation size={15} /> Route to {(places[selected] || places[0]).name}
          </a>
        ) : (
          <a className="nearby-cta" href={searchUrl} target="_blank" rel="noopener noreferrer">
            <MapPin size={15} /> Search {String(data.subject || "places").toLowerCase()} near you in Google Maps
          </a>
        )}
        {fromOsm && <small className="nearby-credit">Map data © OpenStreetMap contributors</small>}
      </footer>
    </section>
  );
}
