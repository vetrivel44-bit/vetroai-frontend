import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Compass, Navigation, Loader2, MapPin, ExternalLink, LocateFixed, Map as MapIcon, Satellite } from 'lucide-react';
import { motion as Motion } from 'framer-motion';
import 'leaflet/dist/leaflet.css';
import '../../styles/StructuredResponse.css';
import ImageGallery from './ImageGallery';

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Cache to store geocoding results and avoid duplicate API calls
const geocodeCache = new Map();
const EMPTY_LIST = Object.freeze([]);

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizePoint = (value, fallbackLabel = '') => {
  if (!value || typeof value !== 'object') return null;
  const source = value.location && typeof value.location === 'object' ? value.location : value;
  const lat = toFiniteNumber(source.lat ?? source.latitude);
  const lng = toFiniteNumber(source.lng ?? source.lon ?? source.longitude);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    ...value,
    lat,
    lng,
    label: value.label || value.name || fallbackLabel || 'Location',
  };
};

const isNearbyQuery = (query = '') => /\b(near\s+me|nearby|nearest|closest|around\s+me|close\s+to\s+me)\b/i.test(String(query));
const cleanNearbyQuery = (query = '') => String(query)
  .replace(/\b(near\s+me|nearby|nearest|closest|around\s+me|close\s+to\s+me)\b/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim() || 'places';

let cachedCurrentCoordinates = null;
const getCurrentCoordinates = async () => {
  if (cachedCurrentCoordinates) return cachedCurrentCoordinates;

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const exact = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 7000,
          maximumAge: 300000,
        });
      });
      cachedCurrentCoordinates = normalizePoint(exact.coords, 'Your location');
      if (cachedCurrentCoordinates) return cachedCurrentCoordinates;
    } catch {
      // Fall through to an approximate IP location when precise permission is unavailable.
    }
  }

  try {
    const response = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    cachedCurrentCoordinates = normalizePoint({
      lat: data.latitude,
      lng: data.longitude,
      label: data.city ? `Near ${data.city}` : 'Your approximate location',
    });
    return cachedCurrentCoordinates;
  } catch {
    return null;
  }
};

const makePinIcon = (type, index = 0) => {
  const content = type === 'user' ? '' : type === 'start' ? 'A' : type === 'end' ? 'B' : String(index + 1);
  return new L.DivIcon({
    className: 'vetro-map-pin-host',
    html: `<div class="vetro-map-pin ${type || 'place'}"><span>${content}</span></div>`,
    iconSize: type === 'user' ? [30, 30] : [36, 44],
    iconAnchor: type === 'user' ? [15, 15] : [18, 42],
    popupAnchor: type === 'user' ? [0, -14] : [0, -38],
  });
};

const ChangeView = ({ center, zoom, bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (Array.isArray(center) && center.every(Number.isFinite)) {
      map.setView(center, zoom);
    }
  }, [center, zoom, bounds, map]);
  return null;
};

const LocationMap = ({ 
  type = "location", 
  place, 
  summary, 
  coordinates, 
  points = EMPTY_LIST,
  details = EMPTY_LIST,
  origin, 
  destination, 
  waypoints = EMPTY_LIST,
  delay = 0 
}) => {
  const pointList = React.useMemo(() => Array.isArray(points) ? points : EMPTY_LIST, [points]);
  const waypointList = React.useMemo(() => Array.isArray(waypoints) ? waypoints : EMPTY_LIST, [waypoints]);
  const detailList = React.useMemo(() => Array.isArray(details) ? details : EMPTY_LIST, [details]);
  const isRoute = Boolean(type === "route" || (origin && destination));
  const initialCoordinates = normalizePoint(coordinates, place);
  
  const [mapData, setMapData] = useState({
    center: initialCoordinates ? [initialCoordinates.lat, initialCoordinates.lng] : [20.5937, 78.9629],
    zoom: isRoute ? 6 : 13,
    markers: [],
    path: [],
    loading: true,
    error: null
  });

  const [mapType, setMapType] = useState('street'); // 'street' or 'satellite'
  const [mapImages, setMapImages] = useState([]);

  // Use a ref to track the last processed parameters to prevent redundant fetching
  const lastParamsRef = React.useRef("");

  useEffect(() => {
    // Create a stable string representation of relevant props
    const currentParams = JSON.stringify({ place, coordinates, points: pointList, origin, destination, waypoints: waypointList, isRoute });
    
    // Skip if props haven't actually changed (avoids loops during streaming)
    if (currentParams === lastParamsRef.current) return;
    lastParamsRef.current = currentParams;

    let isMounted = true;
    const abortController = new AbortController();

    const initMap = async () => {
      // Avoid flash of loading if we already have data in sync (like coordinates)
      if (!coordinates && pointList.length === 0 && !origin && !destination) {
        setMapData(prev => ({ ...prev, loading: true }));
      }
      
      try {
        const geocode = async (q, userLocation = null) => {
          if (!q) return null;
          const cacheKey = `${q.trim().toLowerCase()}|${userLocation ? `${userLocation.lat.toFixed(3)},${userLocation.lng.toFixed(3)}` : ''}`;
          if (geocodeCache.has(cacheKey)) {
            return geocodeCache.get(cacheKey);
          }
          try {
            const params = new URLSearchParams({ query: q, limit: userLocation ? '8' : '6' });
            if (userLocation) {
              params.set('lat', String(userLocation.lat));
              params.set('lng', String(userLocation.lng));
              params.set('radius', '10000');
            }
            const res = await fetch(`/api/maps/search?${params.toString()}`, {
              signal: abortController.signal
            });
            const d = await res.json();
            if (d?.success && Array.isArray(d.data)) {
              const results = d.data
                .map((placeObj) => normalizePoint(placeObj, q))
                .filter(Boolean);
              geocodeCache.set(cacheKey, results);
              return results;
            }
            geocodeCache.set(cacheKey, []);
            return [];
          } catch (e) {
            if (e.name !== 'AbortError') geocodeCache.set(cacheKey, []);
            return [];
          }
        };

        if (isRoute) {
          const start = normalizePoint(origin, 'Start') || (await geocode(origin))?.[0];
          const end = normalizePoint(destination, 'Destination') || (await geocode(destination))?.[0];

          if (!isMounted) return;

          if (!start || !end) {
            setMapData(prev => ({ ...prev, error: "Could not resolve route endpoints", loading: false }));
            return;
          }

          const resolvedWaypoints = [];
          for (const wp of waypointList) {
            const r = normalizePoint(wp) || (typeof wp === 'string' ? (await geocode(wp))?.[0] : null);
            if (r) resolvedWaypoints.push(r);
          }

          if (!isMounted) return;

          const markers = [
            { ...start, type: 'start' },
            ...resolvedWaypoints.map(w => ({ ...w, type: 'mid' })),
            { ...end, type: 'end' }
          ];

          setMapData({
            center: [start.lat, start.lng],
            zoom: 6,
            markers,
            path: markers.map(m => [m.lat, m.lng]),
            loading: false,
            error: null
          });
        } else {
          const validCoordinates = normalizePoint(coordinates, place);
          const validPoints = pointList
            .map((point, index) => normalizePoint(point, `Location ${index + 1}`))
            .filter(Boolean);
          let markers = validPoints.length > 0 ? validPoints : (validCoordinates ? [validCoordinates] : []);
          let center = validCoordinates ? [validCoordinates.lat, validCoordinates.lng] : [20.5937, 78.9629];
          
          if (!validCoordinates && validPoints.length === 0 && place) {
            const nearby = isNearbyQuery(place);
            const userLocation = nearby ? await getCurrentCoordinates() : null;
            if (nearby && !userLocation) {
              setMapData(prev => ({ ...prev, error: 'Allow location access to find places near you.', loading: false }));
              return;
            }

            const results = await geocode(nearby ? cleanNearbyQuery(place) : place, userLocation);
            if (!isMounted) return;
            if (results?.length) {
              if (nearby && userLocation) {
                center = [userLocation.lat, userLocation.lng];
                markers = [{ ...userLocation, type: 'user' }, ...results.map((result) => ({ ...result, type: 'place' }))];
              } else {
                center = [results[0].lat, results[0].lng];
                markers = [results[0]];
              }
            } else {
              setMapData(prev => ({ ...prev, error: "Location not found", loading: false }));
              return;
            }
          }

          if (!isMounted) return;

          setMapData({
            center,
            zoom: 13,
            markers,
            path: [],
            loading: false,
            error: null
          });
        }
      } catch {
        if (isMounted) {
          setMapData(prev => ({ ...prev, error: "Map initialization failed", loading: false }));
        }
      }
    };

    initMap();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [place, coordinates, pointList, origin, destination, waypointList, isRoute]);

  useEffect(() => {
    const imageQuery = isRoute ? `${origin} to ${destination}` : place;
    if (!imageQuery) return;

    let isMounted = true;
    const abortController = new AbortController();

    fetch(`/api/maps/images?query=${encodeURIComponent(imageQuery)}`, { signal: abortController.signal })
      .then((res) => res.json())
      .then((d) => { if (isMounted && d?.success) setMapImages(d.data || []); })
      .catch(() => {});

    return () => { isMounted = false; abortController.abort(); };
  }, [place, origin, destination, isRoute]);

  const validMarkers = mapData.markers.filter((marker) => normalizePoint(marker));
  const bounds = validMarkers.length > 1
    ? L.latLngBounds(validMarkers.map(m => [m.lat, m.lng]))
    : null;
  const destinationMarker = validMarkers.find((marker) => marker.type !== 'user') || null;

  const googleMapsUrl = isRoute 
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(typeof origin === 'string' ? origin : origin?.label || `${origin?.lat},${origin?.lng}`)}&destination=${encodeURIComponent(typeof destination === 'string' ? destination : destination?.label || `${destination?.lat},${destination?.lng}`)}${waypointList.length ? `&waypoints=${waypointList.map(w => encodeURIComponent(typeof w === 'string' ? w : w.label || `${w.lat},${w.lng}`)).join('|')}` : ''}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place || (destinationMarker ? `${destinationMarker.lat},${destinationMarker.lng}` : ""))}`;

  return (
    <Motion.div
      className="structured-location-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay }}
    >
      <div className="location-info">
        <div className="location-header">
          <div className="location-icon">
            {isRoute ? <Navigation size={24} /> : <MapPin size={24} />}
          </div>
          <div className="location-title-group" style={{ minWidth: 0 }}>
            <span className="location-label">{isRoute ? 'Navigation' : 'Location'}</span>
            <h3 style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{isRoute ? `${origin} → ${destination}` : (place || "Map View")}</h3>
          </div>
        </div>
        
        {mapData.loading ? (
          <div className="location-loading-state">
            <Loader2 className="animate-spin" size={20} />
            <span>Updating map...</span>
          </div>
        ) : mapData.error ? (
          <div className="location-error-state">{mapData.error}</div>
        ) : (
          <p className="location-summary">{summary || (isRoute ? "Route endpoints are ready to explore." : validMarkers.length > 1 ? `${validMarkers.length - (validMarkers.some(marker => marker.type === 'user') ? 1 : 0)} nearby places found.` : "Interactive location map ready.")}</p>
        )}

        {detailList.length > 0 && (
          <div className="location-details-grid">
            {detailList.map((d, i) => (
              <div key={i} className="location-detail-item">
                <span className="detail-label">{d.label}</span>
                <span className="detail-value">{d.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {mapImages.length > 0 && (
        <ImageGallery query={isRoute ? `${origin} → ${destination}` : place} images={mapImages} delay={delay + 0.1} />
      )}

      <div className="map-wrapper">
        <div className="map-canvas-shell">
          <MapContainer 
            center={mapData.center} 
            zoom={mapData.zoom} 
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <ChangeView center={mapData.center} zoom={mapData.zoom} bounds={bounds} />
            
            {/* Key-free, production-safe OpenStreetMap and Esri layers. */}
            {mapType === 'street' ? (
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                maxZoom={19}
              />
            ) : (
              <>
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  maxZoom={19}
                />
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </>
            )}
            
            {mapData.path.length > 1 && (
              <Polyline positions={mapData.path} color="#4285F4" weight={5} opacity={0.7} />
            )}

            {validMarkers.map((m, i) => {
              const icon = makePinIcon(m.type || (isRoute ? (i === 0 ? 'start' : 'end') : 'place'), i);
              return (
                <Marker key={`${m.lat}-${m.lng}-${i}`} position={[m.lat, m.lng]} icon={icon}>
                  <Popup>
                    <div className="map-popup-content">
                      <strong>{m.label || place}</strong>
                      {m.address && <span>{m.address}</span>}
                      {m.rating && <small>★ {m.rating}{m.reviews ? ` · ${m.reviews} reviews` : ''}</small>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Map Controls */}
          <div className="map-layer-switch" aria-label="Map style">
            <button
              className={`map-layer-btn ${mapType === 'street' ? 'active' : ''}`}
              onClick={() => setMapType('street')}
              aria-pressed={mapType === 'street'}
            ><MapIcon size={14} /> Map</button>
            <button
              className={`map-layer-btn ${mapType === 'satellite' ? 'active' : ''}`}
              onClick={() => setMapType('satellite')}
              aria-pressed={mapType === 'satellite'}
            ><Satellite size={14} /> Satellite</button>
          </div>

          {validMarkers.some((marker) => marker.type === 'user') && (
            <div className="map-location-badge"><LocateFixed size={14} /> Using your location</div>
          )}
        </div>

        <div className="map-actions-row">
          <button className="map-action-btn primary" disabled={!destinationMarker && !isRoute} onClick={() => window.open(googleMapsUrl, '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={16} />
            <span>Open in Google Maps</span>
          </button>
          <button className="map-action-btn" disabled={!destinationMarker && !isRoute} onClick={() => {
             const dirUrl = isRoute 
               ? googleMapsUrl 
               : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place || `${destinationMarker.lat},${destinationMarker.lng}`)}`;
             window.open(dirUrl, '_blank', 'noopener,noreferrer');
          }}>
            <Compass size={16} />
            <span>Directions</span>
          </button>
        </div>
      </div>
    </Motion.div>
  );
};

export default LocationMap;
