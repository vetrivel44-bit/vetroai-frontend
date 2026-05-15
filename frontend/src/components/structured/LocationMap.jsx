import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Compass, Navigation, Loader2, MapPin, ArrowRight, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import 'leaflet/dist/leaflet.css';
import '../../styles/StructuredResponse.css';

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

  useEffect(() => {
    const initMap = async () => {
      setMapData(prev => ({ ...prev, loading: true }));
      try {
        const geocode = async (q) => {
          if (!q) return null;
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`);
          const d = await res.json();
          return d?.[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: q } : null;
        };

        if (isRoute) {
          const start = (origin && typeof origin === 'object') ? origin : await geocode(origin);
          const end = (destination && typeof destination === 'object') ? destination : await geocode(destination);

          if (!start || !end) {
            setMapData(prev => ({ ...prev, error: "Could not resolve route endpoints", loading: false }));
            return;
          }

          const resolvedWaypoints = [];
          for (const wp of waypoints) {
            const r = typeof wp === 'string' ? await geocode(wp) : wp;
            if (r) resolvedWaypoints.push(r);
          }

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
            if (r) {
              center = [r.lat, r.lng];
              markers = [{ ...r, label: place }];
            } else {
              setMapData(prev => ({ ...prev, error: "Location not found", loading: false }));
              return;
            }
          }

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
        setMapData(prev => ({ ...prev, error: "Map initialization failed", loading: false }));
      }
    };

    initMap();
  }, [place, coordinates, points, origin, destination, waypoints, isRoute]);

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
          <div className="location-title-group">
            <span className="location-label">{isRoute ? 'Navigation' : 'Location'}</span>
            <h3>{isRoute ? `${origin} → ${destination}` : (place || "Map View")}</h3>
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

      <div className="map-wrapper" style={{ height: '400px' }}>
        <div style={{ height: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--structured-border)', position: 'relative' }}>
          <MapContainer 
            center={mapData.center} 
            zoom={mapData.zoom} 
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <ChangeView center={mapData.center} zoom={mapData.zoom} bounds={bounds} />
            
            {/* Google Maps Tiles */}
            {mapType === 'street' ? (
              <TileLayer
                url="http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                subdomains={['mt0','mt1','mt2','mt3']}
                attribution="&copy; Google Maps"
              />
            ) : (
              <TileLayer
                url="http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}"
                subdomains={['mt0','mt1','mt2','mt3']}
                attribution="&copy; Google Maps"
              />
            )}
            
            {mapData.path.length > 1 && (
              <Polyline positions={mapData.path} color="#4285F4" weight={5} opacity={0.7} />
            )}

            {mapData.markers.map((m, i) => (
              <Marker key={i} position={[m.lat, m.lng]} icon={m.type === 'start' ? startIcon : endIcon}>
                <Popup><b>{m.label || place}</b></Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Map Controls */}
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button 
              className={`map-type-btn ${mapType === 'street' ? 'active' : ''}`}
              onClick={() => setMapType('street')}
              style={{ padding: '6px 10px', fontSize: '10px', borderRadius: '4px', border: '1px solid #ccc', background: mapType === 'street' ? '#4285F4' : '#fff', color: mapType === 'street' ? '#fff' : '#333', cursor: 'pointer' }}
            >Map</button>
            <button 
              className={`map-type-btn ${mapType === 'satellite' ? 'active' : ''}`}
              onClick={() => setMapType('satellite')}
              style={{ padding: '6px 10px', fontSize: '10px', borderRadius: '4px', border: '1px solid #ccc', background: mapType === 'satellite' ? '#4285F4' : '#fff', color: mapType === 'satellite' ? '#fff' : '#333', cursor: 'pointer' }}
            >Satellite</button>
          </div>
        </div>

        <div className="map-actions-row" style={{ marginTop: '16px' }}>
          <button className="map-action-btn primary" onClick={() => window.open(googleMapsUrl, '_blank')}>
            <ExternalLink size={16} />
            <span>Open in Google Maps</span>
          </button>
          <button className="map-action-btn secondary" onClick={() => {
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
