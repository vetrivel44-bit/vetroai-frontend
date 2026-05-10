import React, { useState, useEffect } from 'react';
import { Compass, ExternalLink, Navigation, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const LocationMap = ({ place, summary: initialSummary, coordinates: initialCoords, details = [], delay = 0 }) => {
  const [coords, setCoords] = useState(initialCoords);
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(!initialCoords);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!initialCoords && place) {
      const fetchCoords = async () => {
        try {
          setLoading(true);
          const response = await fetch(`${import.meta.env.VITE_API_URL}/api/maps/search?query=${encodeURIComponent(place)}`);
          const result = await response.json();
          
          if (result.success && result.data && result.data.length > 0) {
            const topResult = result.data[0];
            setCoords(topResult.location);
            if (!summary) setSummary(topResult.address || topResult.name);
          } else {
            setError("Location not found");
          }
        } catch (err) {
          console.error("Geocoding error:", err);
          setError("Failed to load map data");
        } finally {
          setLoading(false);
        }
      };
      fetchCoords();
    }
  }, [place, initialCoords, summary]);

  const handleOpenInMaps = () => {
    if (!coords) return;
    // Standard Google Maps search URL - works on web and deep-links to app on mobile
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
    window.open(googleMapsUrl, '_blank');
  };

  const handleGetDirections = () => {
    if (!coords) return;
    // Google Maps directions URL - automatically uses 'My Location' as origin if not provided
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`;
    window.open(directionsUrl, '_blank');
  };

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
            <Compass size={24} />
          </div>
          <div className="location-title-group">
            <span className="location-label">Google Maps Analysis</span>
            <h3>{place || "Exploring..."}</h3>
          </div>
        </div>
        
        {loading ? (
          <div className="location-loading-state">
            <Loader2 className="animate-spin" size={20} />
            <span>Connecting to Google Maps...</span>
          </div>
        ) : error ? (
          <div className="location-error-state">{error}</div>
        ) : (
          <>
            <p className="location-summary">{summary}</p>
            {details.length > 0 && (
              <div className="location-details-grid">
                {details.map((detail, idx) => (
                  <div key={idx} className="location-detail-item">
                    <span className="detail-label">{detail.label}</span>
                    <span className="detail-value">{detail.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="map-wrapper">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div 
              key="loader"
              className="map-skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          ) : (
            <motion.div 
              key="map"
              className="map-container-inner"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.8 }}
              style={{ height: '320px', width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--structured-border)' }}
            >
              <iframe
                title="Google Map"
                width="100%"
                height="100%"
                frameBorder="0"
                style={{ border: 0 }}
                src={coords 
                  ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}&hl=en&z=14&output=embed`
                  : `https://www.google.com/maps?q=${encodeURIComponent(place && !place.toLowerCase().includes('india') ? `${place}, India` : place || '')}&hl=en&z=14&output=embed`
                }
                allowFullScreen
              />
            </motion.div>
          )}
        </AnimatePresence>
        
        {!loading && coords && (
          <div className="map-actions-row">
            <button className="map-action-btn primary" onClick={handleOpenInMaps}>
              <Navigation size={14} />
              <span>Open in Google Maps</span>
            </button>
            <button className="map-action-btn secondary" onClick={handleGetDirections}>
              <Compass size={14} />
              <span>Get Directions</span>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default LocationMap;
