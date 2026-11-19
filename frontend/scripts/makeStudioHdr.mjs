// Generates public/hdr/studio.hdr — a small procedural "photo studio" HDR
// environment (warm room gradient + a few soft boxes) for the 3D chess board's
// reflections. Built locally so the app never has to download an HDR at run
// time. Re-run with:  node scripts/makeStudioHdr.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 512;
const H = 256;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "hdr", "studio.hdr");

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const angDiff = (a, b) => {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// A rectangular soft box: centre (azimuth, elevation) in degrees, half sizes,
// edge softness, and RGB radiance.
const boxes = [
  { az: 35, el: 38, hw: 20, hh: 13, soft: 6, rgb: [7.5, 7.0, 6.2] }, // key
  { az: 210, el: 22, hw: 28, hh: 14, soft: 10, rgb: [1.3, 1.45, 1.7] }, // cool fill
  { az: 140, el: 15, hw: 5, hh: 32, soft: 3, rgb: [3.2, 3.0, 2.7] }, // rim strip
  { az: 300, el: 15, hw: 5, hh: 32, soft: 3, rgb: [2.2, 2.1, 2.0] }, // rim strip
];

function radiance(az, el) {
  // Room: warm, dim walls, darker floor, slightly brighter ceiling.
  const up = smooth(-10, 60, el);
  let r = 0.05 + 0.06 * up;
  let g = 0.04 + 0.05 * up;
  let b = 0.03 + 0.04 * up;
  if (el < 0) { r *= 0.5; g *= 0.5; b *= 0.5; }
  // Big overhead diffuser.
  const top = smooth(62, 74, el);
  r += 2.4 * top; g += 2.3 * top; b += 2.1 * top;
  for (const bx of boxes) {
    const dx = angDiff(az, bx.az) * Math.cos((el * Math.PI) / 180);
    const dy = Math.abs(el - bx.el);
    const k = (1 - smooth(bx.hw - bx.soft, bx.hw, dx)) * (1 - smooth(bx.hh - bx.soft, bx.hh, dy));
    r += bx.rgb[0] * k; g += bx.rgb[1] * k; b += bx.rgb[2] * k;
  }
  return [r, g, b];
}

function toRGBE([r, g, b]) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m));
  const s = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * s)), Math.min(255, Math.floor(g * s)), Math.min(255, Math.floor(b * s)), e + 128];
}

const header = `#?RADIANCE\n# procedural studio for VetroAI Chess Arena\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`;
const pixels = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y += 1) {
  const el = 90 - ((y + 0.5) / H) * 180;
  for (let x = 0; x < W; x += 1) {
    const az = ((x + 0.5) / W) * 360;
    const px = toRGBE(radiance(az, el));
    // Flat (non-RLE) scanlines: the loader only treats a line as RLE when it
    // starts with the bytes 2,2 — nudge the first pixel so that never happens.
    if (x === 0 && px[0] === 2 && px[1] === 2) px[1] = 3;
    pixels.set(px, (y * W + x) * 4);
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from(header, "latin1"), pixels]));
console.log(`wrote ${out} (${W}x${H})`);
