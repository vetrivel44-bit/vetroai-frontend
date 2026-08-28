import React, { useState, useEffect, useRef } from 'react';
import { Map as MapTilerMap, MapStyle, Marker, Popup, config as mapTilerConfig } from '@maptiler/sdk';
import { Compass, Navigation, Loader2, MapPin, ArrowRight, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import '../../styles/StructuredResponse.css';
import ImageGallery from './ImageGallery';

// Cache to store geocoding results and avoid duplicate API calls
const geocodeCache = new Map();
// MapTiler is the application's sole map provider.
const MAPTILER_API_KEY = "X8pVgGsWFhZJyTYpijy1";
mapTilerConfig.apiKey = MAPTILER_API_KEY;

const isValidCoordinate = (point) => {
  if (!point || typeof point !== 'object') return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

const normalizeCoordinate = (point, fallbackLabel = '') => isValidCoordinate(point)
  ? { ...point, lat: Number(point.lat), lng: Number(point.lng), label: point.label || fallbackLabel }
  : null;

function MapTilerCanvas({ center, zoom, markers, path, mapType, place }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !Array.isArray(center)) return undefined;
    const map = new MapTilerMap({
      container: containerRef.current,
      style: mapType === 'satellite' ? MapStyle.HYBRID : MapStyle.STREETS_V4,
      center: [center[1], center[0]],
      zoom,
      navigationControl: true,
      geolocateControl: true
    });

    const markerInstances = markers.map((marker, index) => {
      const color = marker.type === 'start' ? '#2563eb' : index === markers.length - 1 ? '#ef4444' : '#7c3aed';
      const popup = new Popup({ offset: 28 }).setText(marker.label || place || 'Location');
      return new Marker({ color }).setLngLat([marker.lng, marker.lat]).setPopup(popup).addTo(map);
    });

    map.on('load', () => {
      if (path.length > 1) {
        map.addSource('vetro-route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path.map(([lat, lng]) => [lng, lat]) } }
        });
        map.addLayer({ id: 'vetro-route-line', type: 'line', source: 'vetro-route', paint: { 'line-color': '#4285f4', 'line-width': 5, 'line-opacity': 0.78 } });
      }
      if (markers.length > 1) {
        const lngs = markers.map(marker => marker.lng);
        const lats = markers.map(marker => marker.lat);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 55, maxZoom: 15 });
      }
    });

    return () => {
      markerInstances.forEach(marker => marker.remove());
      map.remove();
    };
  }, [center, zoom, markers, path, mapType, place]);

  return <div ref={containerRef} className="maptiler-map-canvas" aria-label={`Map of ${place || 'selected locations'}`} />;
}

const LocationMap = ({ 
  type = "location", 
  place, 
  summary, 
  coordinates, 
  points = [], 
  details = [], 
  origin, 
  destination, 
  waypoints = [], 
  delay = 0 
}) => {
  const isRoute = type === "route" || (origin && destination);
  
  const [mapData, setMapData] = useState({
    center: isValidCoordinate(coordinates) ? [Number(coordinates.lat), Number(coordinates.lng)] : [20.5937, 78.9629],
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
    const currentParams = JSON.stringify({ place, coordinates, points, origin, destination, waypoints, isRoute });
    
    // Skip if props haven't actually changed (avoids loops during streaming)
    if (currentParams === lastParamsRef.current) return;
    lastParamsRef.current = currentParams;

    let isMounted = true;
    const abortController = new AbortController();

    const initMap = async () => {
      // Avoid flash of loading if we already have data in sync (like coordinates)
      if (!coordinates && !points.length && !origin && !destination) {
        setMapData(prev => ({ ...prev, loading: true }));
      }
      
      try {
        const geocode = async (q) => {
          if (!q) return null;
          const cacheKey = q.trim().toLowerCase();
          if (geocodeCache.has(cacheKey)) {
            return geocodeCache.get(cacheKey);
          }
          try {
            const res = await fetch(`/api/maps/search?query=${encodeURIComponent(q)}`, {
              signal: abortController.signal
            });
            const d = await res.json();
            if (d?.success && d?.data?.[0]) {
              const placeObj = d.data[0];
              if (placeObj.location) {
                const result = normalizeCoordinate({
                  lat: placeObj.location.lat,
                  lng: placeObj.location.lng,
                  label: placeObj.name || q
                });
                if (result) {
                  geocodeCache.set(cacheKey, result);
                  return result;
                }
              }
            }
            geocodeCache.set(cacheKey, null);
            return null;
          } catch (e) {
            geocodeCache.set(cacheKey, null);
            return null;
          }
        };

        if (isRoute) {
          const start = (origin && typeof origin === 'object') ? normalizeCoordinate(origin, 'Start') : await geocode(origin);
          const end = (destination && typeof destination === 'object') ? normalizeCoordinate(destination, 'Destination') : await geocode(destination);

          if (!isMounted) return;

          if (!start || !end) {
            setMapData(prev => ({ ...prev, error: "Could not resolve route endpoints", loading: false }));
            return;
          }

          const resolvedWaypoints = [];
          for (const wp of waypoints) {
            const r = typeof wp === 'string' ? await geocode(wp) : normalizeCoordinate(wp);
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
          const validCoordinates = normalizeCoordinate(coordinates, place);
          let markers = points.length > 0
            ? points.map((point) => normalizeCoordinate(point, point?.label || place)).filter(Boolean)
            : (validCoordinates ? [validCoordinates] : []);
          let center = validCoordinates ? [validCoordinates.lat, validCoordinates.lng] : [20.5937, 78.9629];
          
          if (!coordinates && points.length === 0 && place) {
            const r = await geocode(place);
            if (!isMounted) return;
            if (r) {
              center = [r.lat, r.lng];
              markers = [{ ...r, label: place }];
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
      } catch (err) {
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
  }, [place, coordinates, points, origin, destination, waypoints, isRoute]);

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

  const safeMarkers = mapData.markers.filter(isValidCoordinate);
  const googleMapsUrl = isRoute 
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypoints.length ? `&waypoints=${waypoints.map(w => encodeURIComponent(typeof w === 'string' ? w : w.label)).join('|')}` : ''}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place || (mapData.markers[0] ? `${mapData.markers[0].lat},${mapData.markers[0].lng}` : ""))}`;

  return (
    <motion.div 
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
          <p className="location-summary">{summary || (isRoute ? "Dynamic route calculation completed." : "Interactive map location resolved.")}</p>
        )}

        {details.length > 0 && (
          <div className="location-details-grid">
            {details.map((d, i) => (
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
        <div style={{ height: 'min(400px, 60vh)', minHeight: 220, borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--structured-border)', position: 'relative' }}>
          <MapTilerCanvas center={mapData.center} zoom={mapData.zoom} markers={safeMarkers} path={mapData.path} mapType={mapType} place={place} />

          {/* Map Controls */}
          <div style={{
            position: 'absolute', top: 8, right: 8, zIndex: 1000,
            display: 'flex', gap: 2, padding: 3,
            background: 'rgba(20,20,24,0.75)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
          }}>
            <button
              className={`map-type-btn ${mapType === 'street' ? 'active' : ''}`}
              onClick={() => setMapType('street')}
              style={{
                padding: '8px 12px', minHeight: 36, fontSize: '11px', borderRadius: 6, border: 'none',
                background: mapType === 'street' ? '#4285F4' : 'transparent',
                color: mapType === 'street' ? '#fff' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s ease'
              }}
            >Map</button>
            <button
              className={`map-type-btn ${mapType === 'satellite' ? 'active' : ''}`}
              onClick={() => setMapType('satellite')}
              style={{
                padding: '8px 12px', minHeight: 36, fontSize: '11px', borderRadius: 6, border: 'none',
                background: mapType === 'satellite' ? '#4285F4' : 'transparent',
                color: mapType === 'satellite' ? '#fff' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s ease'
              }}
            >Satellite</button>
          </div>
        </div>

        <div className="map-actions-row">
          <button className="map-action-btn primary" onClick={() => window.open(googleMapsUrl, '_blank')}>
            <ExternalLink size={16} />
            <span>Open in Google Maps</span>
          </button>
          <button className="map-action-btn" onClick={() => {
             const dirUrl = isRoute 
               ? googleMapsUrl 
               : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place || `${mapData.markers[0]?.lat},${mapData.markers[0]?.lng}`)}`;
             window.open(dirUrl, '_blank');
          }}>
            <Compass size={16} />
            <span>Directions</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default LocationMap;
