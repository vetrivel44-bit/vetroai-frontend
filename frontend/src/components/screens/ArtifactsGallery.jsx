import React, { useState } from 'react';
import { FileText, Code, Image, Database, LayoutGrid, List, Clock, Filter, Share2, Download } from 'lucide-react';

export default function ArtifactsGallery({ onClose }) {
  const [viewMode, setViewMode] = useState('grid');
  
  const artifacts = [
    { id: 1, type: 'document', name: 'Q3 Earnings Report', date: '2 hrs ago', size: '12 KB', icon: FileText, color: '#3b82f6' },
    { id: 2, type: 'code', name: 'Sorting Algorithm.py', date: 'Yesterday', size: '2 KB', icon: Code, color: '#10b981' },
    { id: 3, type: 'media', name: 'UI Mockup.png', date: 'Oct 24', size: '1.2 MB', icon: Image, color: '#8b5cf6' },
    { id: 4, type: 'data', name: 'User Demographics.csv', date: 'Oct 20', size: '45 KB', icon: Database, color: '#f59e0b' },
  ];

  return (
    <div className="feature-shell fade-in" style={{ padding: '16px', height: '100%', overflowY: 'auto', background: 'var(--bg)' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 600, margin: 0, color: 'var(--ink)' }}>Artifacts</h1>
          <p style={{ color: 'var(--ink-2)', margin: 0 }}>All your generated documents, code, and media in one place.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost"><Filter size={18} /> Filter</button>
          <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 8, padding: 4, border: '1px solid var(--border)' }}>
            <button onClick={() => setViewMode('grid')} style={{ padding: 6, minWidth: 36, minHeight: 36, borderRadius: 4, background: viewMode === 'grid' ? 'var(--bg)' : 'transparent', border: 'none', color: viewMode === 'grid' ? 'var(--ink)' : 'var(--ink-3)' }}><LayoutGrid size={18}/></button>
            <button onClick={() => setViewMode('list')} style={{ padding: 6, minWidth: 36, minHeight: 36, borderRadius: 4, background: viewMode === 'list' ? 'var(--bg)' : 'transparent', border: 'none', color: viewMode === 'list' ? 'var(--ink)' : 'var(--ink-3)' }}><List size={18}/></button>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        <button className="mode-pill active" style={{ flexShrink: 0 }}>All</button>
        <button className="mode-pill" style={{ flexShrink: 0 }}>Documents</button>
        <button className="mode-pill" style={{ flexShrink: 0 }}>Code</button>
        <button className="mode-pill" style={{ flexShrink: 0 }}>Media</button>
        <button className="mode-pill" style={{ flexShrink: 0 }}>Data</button>
      </div>

      {viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 16 }}>
          {artifacts.map(a => (
            <div key={a.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', minWidth: 0 }} className="artifact-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ background: a.color + '22', padding: 12, borderRadius: 8, color: a.color }}>
                  <a.icon size={24} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ background: 'none', border: 'none', color: 'var(--ink-3)', minWidth: 32, minHeight: 32 }}><Share2 size={16}/></button>
                  <button style={{ background: 'none', border: 'none', color: 'var(--ink-3)', minWidth: 32, minHeight: 32 }}><Download size={16}/></button>
                </div>
              </div>
              <h3 style={{ fontSize: '1.1rem', margin: '0 0 8px 0', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-3)', fontSize: '0.85rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12}/> {a.date}</span>
                <span>{a.size}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink-3)', fontSize: '0.85rem' }}>
                <th style={{ padding: '16px 20px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '16px 20px', fontWeight: 500 }}>Type</th>
                <th style={{ padding: '16px 20px', fontWeight: 500 }}>Date Modified</th>
                <th style={{ padding: '16px 20px', fontWeight: 500 }}>Size</th>
                <th style={{ padding: '16px 20px', fontWeight: 500, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }} className="artifact-row">
                  <td style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink)' }}>
                    <a.icon size={16} color={a.color} /> {a.name}
                  </td>
                  <td style={{ padding: '16px 20px', color: 'var(--ink-2)', textTransform: 'capitalize' }}>{a.type}</td>
                  <td style={{ padding: '16px 20px', color: 'var(--ink-2)' }}>{a.date}</td>
                  <td style={{ padding: '16px 20px', color: 'var(--ink-2)' }}>{a.size}</td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    <button style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', marginRight: 10 }}><Share2 size={16}/></button>
                    <button style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' }}><Download size={16}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .artifact-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .artifact-row:hover { background: var(--bg); cursor: pointer; }
      `}} />
    </div>
  );
}
