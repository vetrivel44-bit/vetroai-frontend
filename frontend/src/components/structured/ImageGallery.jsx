import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { isLikelyImageUrl } from '../../lib/searchGrounding';
import '../../styles/StructuredResponse.css';

const ImageGallery = ({ query, images = [], delay = 0 }) => {
  const [selectedImage, setSelectedImage] = useState(null);
  // Pictures that failed to load (blocked hotlinks, dead links) are dropped
  // rather than left as blank cards.
  const [failed, setFailed] = useState(() => new Set());

  // Only real image links: a gallery of web pages showed as blank pictures.
  // Random placeholder photos used to stand in for an empty gallery; now an
  // empty gallery isn't shown at all.
  const galleryImages = (Array.isArray(images) ? images : [])
    .filter((img) => img && isLikelyImageUrl(img.url) && !failed.has(img.url));
  if (galleryImages.length === 0) return null;

  const drop = (url) => setFailed((prev) => new Set(prev).add(url));

  return (
    <motion.div 
      className="structured-gallery-wrapper"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay }}
    >
      <div className="gallery-header">
        <ImageIcon size={16} className="gallery-icon" />
        <span>Visual Reference: {query}</span>
      </div>

      <div className="gallery-scroll-container">
        {galleryImages.map((img, idx) => (
          <motion.div 
            key={img.url}
            className="gallery-card"
            whileHover={{ y: -5 }}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: delay + (idx * 0.1) }}
            onClick={() => setSelectedImage(img)}
          >
            <div className="gallery-image-container">
              <img
                src={img.url}
                alt={img.caption}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => drop(img.url)}
                onLoad={(e) => { if (!e.currentTarget.naturalWidth) drop(img.url); }}
              />
              <div className="gallery-overlay">
                <Maximize2 size={20} />
              </div>
            </div>
            {img.caption && <div className="gallery-caption">{img.caption}</div>}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            className="gallery-lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
          >
            <motion.div 
              className="lightbox-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="lightbox-close" onClick={() => setSelectedImage(null)}>
                <X size={24} />
              </button>
              <img src={selectedImage.url} alt={selectedImage.caption} referrerPolicy="no-referrer" />
              <div className="lightbox-footer">
                <h3>{selectedImage.caption}</h3>
                <a href={selectedImage.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />
                  View Original
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ImageGallery;
