import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const ArchitectureDiagram = ({ title, nodes, connections, delay = 0 }) => {
  return (
    <motion.div 
      className="structured-diagram"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay }}
    >
      {title && <h2>{title}</h2>}
      <div className="structured-diagram-content">
        <svg width="100%" height="400" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--structured-accent)" opacity="0.6" />
            </marker>
            <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          
          {/* Connections with animated paths */}
          {connections.map((conn, idx) => (
            <motion.path
              key={idx}
              d={`M ${conn.from.x} ${conn.from.y} L ${conn.to.x} ${conn.to.y}`}
              stroke="var(--structured-accent)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#arrowhead)"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.3 }}
              transition={{ duration: 1.5, delay: delay + 0.5 + (idx * 0.2) }}
            />
          ))}

          {/* Nodes as floating pills */}
          {nodes.map((node, idx) => (
            <motion.g
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: delay + 0.3 + (idx * 0.1) }}
            >
              <rect
                x={node.x - 60}
                y={node.y - 25}
                width="120"
                height="50"
                rx="25"
                fill="var(--structured-card)"
                stroke="var(--structured-border)"
                strokeWidth="1.5"
                style={{ filter: 'url(#softGlow)' }}
              />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--structured-text-primary)"
                style={{ fontSize: '11px', fontWeight: '800', fontFamily: 'var(--structured-font)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                {node.label}
              </text>
            </motion.g>
          ))}
        </svg>
      </div>
    </motion.div>
  );
};

export default ArchitectureDiagram;
