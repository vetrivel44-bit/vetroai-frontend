import React from 'react';
import { Folder, Users, Search, Plus, UploadCloud, ChevronRight, Lock } from 'lucide-react';

export default function SpacesHub({ onClose }) {
  const spaces = [
    { id: 1, name: 'College', description: 'Study notes and research', members: 1, files: 12, color: '#3b82f6', isPrivate: true },
    { id: 2, name: 'Startup', description: 'Product roadmap and pitch decks', members: 4, files: 28, color: '#f59e0b', isPrivate: false },
    { id: 3, name: 'Research', description: 'Academic papers and PDFs', members: 2, files: 105, color: '#10b981', isPrivate: false },
    { id: 4, name: 'Personal', description: 'Daily journaling and tasks', members: 1, files: 3, color: '#ec4899', isPrivate: true },
  ];

  return (
    <div className="feature-shell fade-in" style={{ padding: '16px', height: '100%', overflowY: 'auto', background: 'var(--bg)' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 600, margin: 0, color: 'var(--ink)' }}>Spaces Hub</h1>
          <p style={{ color: 'var(--ink-2)', margin: 0 }}>Organize your work into projects, collaborate, and build knowledge bases.</p>
        </div>
        <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={18}/> New Space</button>
      </header>

      <div style={{ display: 'flex', gap: 20, marginBottom: 30 }}>
        <div style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Search size={20} color="var(--ink-3)" />
          <input type="text" placeholder="Search across all your spaces..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'var(--ink)', fontSize: '1rem' }} />
        </div>
      </div>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 16px 0', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: 1 }}>Your Spaces</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 16, marginBottom: 40 }}>
        {spaces.map(s => (
          <div key={s.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }} className="space-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: s.color + '22', padding: 12, borderRadius: 8, color: s.color }}>
                  <Folder size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--ink)' }}>{s.name}</h3>
                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {s.isPrivate ? <Lock size={12}/> : <Users size={12}/>} {s.isPrivate ? 'Private' : 'Shared'}
                  </div>
                </div>
              </div>
              <ChevronRight size={20} color="var(--ink-4)" className="space-card-arrow" />
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-2)' }}>{s.description}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 16, fontSize: '0.85rem', color: 'var(--ink-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Users size={14}/> {s.members} members</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UploadCloud size={14}/> {s.files} files</span>
            </div>
          </div>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .space-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .space-card:hover .space-card-arrow { color: var(--ink); transform: translateX(2px); transition: 0.2s; }
      `}} />
    </div>
  );
}
