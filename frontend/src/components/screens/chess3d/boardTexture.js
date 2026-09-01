import * as THREE from "three";

// Procedurally painted checkered wood-grain texture for the board surface —
// generated once on a canvas and cached, so every board instance shares it.
let cached = null;

export function getBoardTexture() {
  if (cached) return cached;
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const squares = 8;
  const sq = size / squares;

  const light = ["#f4e2bd", "#eed6ab", "#f8ecd0"];
  const dark = ["#8a5a34", "#7a4c28", "#9a6a3e"];

  for (let r = 0; r < squares; r += 1) {
    for (let f = 0; f < squares; f += 1) {
      const isDark = (r + f) % 2 === 1;
      const palette = isDark ? dark : light;
      const x = f * sq;
      const y = r * sq;

      const grad = ctx.createLinearGradient(x, y, x + sq, y + sq);
      grad.addColorStop(0, palette[2]);
      grad.addColorStop(0.5, palette[0]);
      grad.addColorStop(1, palette[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, sq, sq);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, sq, sq);
      ctx.clip();
      ctx.strokeStyle = isDark ? "rgba(35,18,5,0.14)" : "rgba(110,72,28,0.12)";
      for (let i = 0; i < 7; i += 1) {
        ctx.lineWidth = 0.6 + Math.random() * 1.6;
        const gy = y + (i / 7) * sq + Math.random() * 6;
        ctx.beginPath();
        ctx.moveTo(x - 2, gy + (Math.random() - 0.5) * 8);
        ctx.bezierCurveTo(
          x + sq * 0.3, gy + (Math.random() - 0.5) * 14,
          x + sq * 0.7, gy + (Math.random() - 0.5) * 14,
          x + sq + 2, gy + (Math.random() - 0.5) * 8,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Faint inner border line around the playable area for a finished, inlaid look.
  ctx.strokeStyle = "rgba(20,12,4,0.35)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cached = texture;
  return texture;
}
