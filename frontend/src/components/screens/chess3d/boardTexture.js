import * as THREE from "three";

// Procedurally painted checkered wood-grain texture for the board surface —
// generated once on a canvas and cached, so every board instance shares it.
let cached = null;
let cachedFrame = null;

function paintWoodGrain(ctx, x, y, w, h, baseColor, grainColor, seed) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, w, h);

  // Long, mostly-parallel grain lines (the look of a sawn wood veneer)
  // rather than random scribbles.
  ctx.strokeStyle = grainColor;
  const lines = 10;
  for (let i = 0; i < lines; i += 1) {
    const t = i / (lines - 1);
    const gy = y + t * h;
    const wobble = Math.sin(seed + i * 1.7) * h * 0.05;
    ctx.lineWidth = 0.5 + ((seed + i) % 3) * 0.5;
    ctx.globalAlpha = 0.16 + ((seed + i * 3) % 5) * 0.02;
    ctx.beginPath();
    ctx.moveTo(x - 2, gy + wobble);
    ctx.bezierCurveTo(
      x + w * 0.35, gy + wobble + Math.sin(seed + i) * h * 0.06,
      x + w * 0.65, gy + wobble - Math.sin(seed + i * 2) * h * 0.06,
      x + w + 2, gy + wobble,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Soft directional sheen so the finish reads as glossy/lacquered.
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.06)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function getBoardTexture() {
  if (cached) return cached;
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const squares = 8;
  const sq = size / squares;

  const light = { base: "#f2e3c4", grain: "#c9a463" };
  const dark = { base: "#7a3a22", grain: "#3d1a0c" };

  for (let r = 0; r < squares; r += 1) {
    for (let f = 0; f < squares; f += 1) {
      const isDark = (r + f) % 2 === 1;
      const palette = isDark ? dark : light;
      paintWoodGrain(ctx, f * sq, r * sq, sq, sq, palette.base, palette.grain, r * 8 + f);
    }
  }

  // Thin inlay line between squares for a "veneer strips" look.
  ctx.strokeStyle = "rgba(35,18,6,0.28)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= squares; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * sq, 0); ctx.lineTo(i * sq, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * sq); ctx.lineTo(size, i * sq); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(20,10,3,0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cached = texture;
  return texture;
}

// Mahogany frame texture — long horizontal grain strokes, richer and darker
// than the board squares, used on the surrounding border boxes.
export function getFrameTexture() {
  if (cachedFrame) return cachedFrame;
  const w = 512;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#6b3016");
  grad.addColorStop(0.5, "#4a1f0d");
  grad.addColorStop(1, "#341507");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 26; i += 1) {
    ctx.lineWidth = 0.6 + (i % 3) * 0.6;
    ctx.globalAlpha = 0.18 + (i % 4) * 0.05;
    const y = (i / 26) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + Math.sin(i) * 6, w * 0.7, y - Math.sin(i * 1.3) * 6, w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.15)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cachedFrame = texture;
  return texture;
}
