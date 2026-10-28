import React from 'react';
import './OrbitLoader.css';

// Two dots circling a pulsing core; shown while waiting for the first reply chunk.
export default function OrbitLoader({
  size = 26,
  core = '#3fd0c9',
  dotA = '#9be8e4',
  dotB = '#b78bff',
  label = 'VetroAi is thinking',
}) {
  const style = {
    '--orbit-size': `${size}px`,
    '--orbit-core': core,
    '--orbit-a': dotA,
    '--orbit-b': dotB,
  };

  return (
    <span className="vetro-orbit" role="status" aria-label={label} style={style}>
      <i /><i />
    </span>
  );
}
