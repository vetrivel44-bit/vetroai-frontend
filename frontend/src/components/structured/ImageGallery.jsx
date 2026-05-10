import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, ExternalLink, Image as ImageIcon } from 'lucide-react';
import '../../styles/StructuredResponse.css';

const ImageGallery = ({ query, images = [], delay = 0 }) => {
  const [selectedImage, setSelectedImage] = useState(null);

  // If images are not provided but query is, we can use a placeholder search service
  const galleryImages = images.length > 0 ? images : [
    { url: `https://loremflickr.com/800/600/${query},landscape?lock=1`, caption: `${query} View 1` },
    { url: `https://loremflickr.com/800/600/${query},city?lock=2`, caption: `${query} View 2` },
    { url: `https://loremflickr.com/800/600/${query},nature?lock=3`, caption: `${query} View 3` },
  ];

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
            key={idx}
            className="gallery-card"
            whileHover={{ y: -5 }}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: delay + (idx * 0.1) }}
            onClick={() => setSelectedImage(img)}
          >
            <div className="gallery-image-container">
              <img src={img.url} alt={img.caption} loading="lazy" />
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
              <img src={selectedImage.url} alt={selectedImage.caption} />
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
