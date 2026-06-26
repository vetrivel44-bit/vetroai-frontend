import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Compass, Navigation, Loader2, MapPin, ArrowRight, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
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

// Custom Marker Icons
const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const makePhotoIcon = (url) => new L.DivIcon({
  className: 'photo-pin-icon',
  html: `
    <div class="photo-pin">
      <div class="photo-pin-ring"><img src="${url}" alt="" /></div>
      <div class="photo-pin-tail"></div>
    </div>
  `,
  iconSize: [52, 64],
  iconAnchor: [26, 60],
  popupAnchor: [0, -58],
});

const ChangeView = ({ center, zoom, bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (center) {
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
  points = [], 
  details = [], 
  origin, 
  destination, 
  waypoints = [], 
  delay = 0 
}) => {
  const isRoute = type === "route" || (origin && destination);
  
  const [mapData, setMapData] = useState({
    center: coordinates ? [coordinates.lat, coordinates.lng] : [20.5937, 78.9629],
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
                const result = {
                  lat: placeObj.location.lat,
                  lng: placeObj.location.lng,
                  label: placeObj.name || q
                };
                geocodeCache.set(cacheKey, result);
                return result;
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
          const start = (origin && typeof origin === 'object') ? origin : await geocode(origin);
          const end = (destination && typeof destination === 'object') ? destination : await geocode(destination);

          if (!isMounted) return;

          if (!start || !end) {
            setMapData(prev => ({ ...prev, error: "Could not resolve route endpoints", loading: false }));
            return;
          }

          const resolvedWaypoints = [];
          for (const wp of waypoints) {
            const r = typeof wp === 'string' ? await geocode(wp) : wp;
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
          let markers = points.length > 0 ? points : (coordinates ? [{ ...coordinates, label: place }] : []);
          let center = coordinates ? [coordinates.lat, coordinates.lng] : [20.5937, 78.9629];
          
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

  const bounds = mapData.markers.length > 1 
    ? L.latLngBounds(mapData.markers.map(m => [m.lat, m.lng])) 
    : (mapData.markers.length === 1 ? L.latLngBounds([[mapData.markers[0].lat, mapData.markers[0].lng]]) : null);

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
          <MapContainer 
            center={mapData.center} 
            zoom={mapData.zoom} 
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <ChangeView center={mapData.center} zoom={mapData.zoom} bounds={bounds} />
            
            {/* Legal Open-Source Tiles (OpenStreetMap & Esri) */}
            {mapType === 'street' ? (
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                subdomains="abcd"
                maxZoom={20}
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

            {mapData.markers.map((m, i) => {
              const icon = isRoute
                ? (m.type === 'start' ? startIcon : endIcon)
                : (mapImages[0]?.url ? makePhotoIcon(mapImages[0].url) : endIcon);
              return (
                <Marker key={i} position={[m.lat, m.lng]} icon={icon}>
                  <Popup><b>{m.label || place}</b></Popup>
                </Marker>
              );
            })}
          </MapContainer>

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
