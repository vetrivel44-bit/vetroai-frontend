import React, { useEffect, useRef } from 'react';
import './AuthHeroBird.css';

const PHOTO = '/login/milky-way.jpg';
const TILE = 8;           // mosaic tile size in CSS px
const REPEL_RADIUS = 120; // how far the cursor reaches
const PUSH = 14;          // max px a tile is pushed away
const FOCUS_Y = 0.42;     // vertical focal point of the photo when cropping to cover
const SUB = 4;            // sub-samples per tile edge, used to keep stars

// Per-tile colours for the photo cropped to cover W×H. Each tile is its
// average colour pulled toward its brightest sub-sample, so single stars
// survive as bright pixels instead of averaging away.
function sampleTiles(img, W, H, cols, rows) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  const x = (W - w) / 2, y = (H - h) * FOCUS_Y;
  const c = document.createElement('canvas');
  c.width = cols * SUB; c.height = rows * SUB;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  const k = SUB / TILE;
  g.drawImage(img, x * k, y * k, w * k, h * k);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      let sr = 0, sg = 0, sb = 0, best = -1, br = 0, bg = 0, bb = 0;
      for (let yy = 0; yy < SUB; yy++) {
        for (let xx = 0; xx < SUB; xx++) {
          const o = ((r * SUB + yy) * c.width + col * SUB + xx) * 4;
          sr += d[o]; sg += d[o + 1]; sb += d[o + 2];
          const lum = d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11;
          if (lum > best) { best = lum; br = d[o]; bg = d[o + 1]; bb = d[o + 2]; }
        }
      }
      const n = SUB * SUB;
      const ar = sr / n, ag = sg / n, ab = sb / n;
      const avgLum = ar * 0.3 + ag * 0.59 + ab * 0.11;
      const star = Math.max(0, Math.min(1, (best - avgLum - 25) / 80));
      // A touch of extra saturation and contrast gives the pixel-art look.
      const sat = (v, m) => Math.max(0, Math.min(255, m + (v - m) * 1.25));
      out[r * cols + col] = {
        rgb: [sat(ar + (br - ar) * star * 0.85, avgLum), sat(ag + (bg - ag) * star * 0.85, avgLum), sat(ab + (bb - ab) * star * 0.85, avgLum)],
        star,
      };
    }
  }
  return out;
}

// Login hero: the night-sky photo rebuilt as a pixel mosaic. Bright tiles
// twinkle; tiles around the cursor are pushed out, enlarged and brightened
// and spring back as it moves on; a click sends a ripple through the mosaic.
// Place it as a direct child of .auth-hero-side.
export default function AuthHeroBird() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!host) return undefined;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: -1e4, y: -1e4 };
    const ripples = [];
    const img = new Image();
    // Grout layer: each tile's slot in a darker shade of its own colour,
    // painted once, so gaps and pushed-away tiles never show a hole.
    const grout = document.createElement('canvas');
    const gctx = grout.getContext('2d');
    let tiles = [], W = 0, H = 0, raf = 0, alive = true;

    const build = () => {
      if (!img.naturalWidth) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = host.clientWidth; H = host.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      grout.width = canvas.width; grout.height = canvas.height;
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(W / TILE), rows = Math.ceil(H / TILE);
      const colours = sampleTiles(img, W, H, cols, rows);
      tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const { rgb, star } = colours[r * cols + c];
          const x = c * TILE, y = r * TILE;
          tiles.push({ x, y, base: rgb, star, j: 0.96 + Math.random() * 0.08, phase: Math.random() * 6.28, ox: 0, oy: 0, s: 1, b: 0 });
          gctx.fillStyle = `rgb(${(rgb[0] * 0.82) | 0},${(rgb[1] * 0.82) | 0},${(rgb[2] * 0.82) | 0})`;
          gctx.fillRect(x, y, TILE, TILE);
        }
      }
    };

    const draw = (ms) => {
      const t = ms / 1000;
      ctx.drawImage(grout, 0, 0, W, H);
      for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].t0 > 1.6) ripples.splice(i, 1);

      for (const p of tiles) {
        const cx = p.x + TILE / 2, cy = p.y + TILE / 2;
        let tx = 0, ty = 0, ts = 1, tb = 0;
        const dx = cx - mouse.x, dy = cy - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < REPEL_RADIUS) {
          const k = 1 - d / REPEL_RADIUS, e = k * k;
          // Push peaks part-way out and is zero under the cursor, so no hole opens there.
          const push = k * (1 - k) * 4 * PUSH;
          tx = (dx / (d || 1)) * push; ty = (dy / (d || 1)) * push;
          ts = 1 + e * 0.55; tb = e * 0.5;
        }
        for (const r of ripples) {
          const rx = cx - r.x, ry = cy - r.y, rd = Math.hypot(rx, ry);
          const age = t - r.t0, ring = age * 520, band = 46;
          if (Math.abs(rd - ring) < band) {
            const k = (1 - Math.abs(rd - ring) / band) * (1 - age / 1.6);
            tx += (rx / (rd || 1)) * k * 12; ty += (ry / (rd || 1)) * k * 12;
            ts += k * 0.5; tb += k * 0.5;
          }
        }
        p.ox += (tx - p.ox) * 0.16; p.oy += (ty - p.oy) * 0.16;
        p.s += (ts - p.s) * 0.16; p.b += (tb - p.b) * 0.16;

        // Star tiles twinkle; everything else barely shimmers.
        const tw = reduce ? 1 : 1 + Math.sin(t * (1.2 + p.star * 2.5) + p.phase) * (0.02 + p.star * 0.22);
        const f = p.j * tw;
        const col = p.base;
        // Lit tiles glow toward a cool starlight blue rather than plain white.
        const r = Math.min(255, col[0] * f + (170 - col[0] * 0.4) * p.b);
        const g = Math.min(255, col[1] * f + (215 - col[1] * 0.4) * p.b);
        const bl = Math.min(255, col[2] * f + (255 - col[2] * 0.4) * p.b);
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
        const size = (TILE - 1) * p.s;
        ctx.fillRect(cx + p.ox - size / 2, cy + p.oy - size / 2, size, size);
      }
    };

    const loop = (ms) => { if (!alive) return; draw(ms); raf = requestAnimationFrame(loop); };
    const local = (e) => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onMove = (e) => { [mouse.x, mouse.y] = local(e); };
    const onLeave = () => { mouse.x = -1e4; mouse.y = -1e4; };
    const onDown = (e) => { const [x, y] = local(e); ripples.push({ x, y, t0: performance.now() / 1000 }); };

    const ro = new ResizeObserver(() => { build(); if (reduce) draw(0); });
    img.onload = () => {
      if (!alive) return;
      build();
      canvas.classList.add('ready');
      ro.observe(host);
      if (reduce) draw(0);
      else {
        raf = requestAnimationFrame(loop);
        host.addEventListener('pointermove', onMove);
        host.addEventListener('pointerleave', onLeave);
        host.addEventListener('pointerdown', onDown);
      }
    };
    img.src = PHOTO;
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="ahb-canvas" aria-hidden="true" />
      <a
        className="ahb-credit"
        href="https://commons.wikimedia.org/wiki/File:Gazing_at_the_Milky_Way_Morvan_2019-08-31.jpg"
        target="_blank"
        rel="noopener noreferrer"
      >
        Based on a photo by Benh LIEU SONG, CC BY-SA 4.0
      </a>
    </>
  );
}
