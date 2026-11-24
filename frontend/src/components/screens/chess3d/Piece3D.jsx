import React, { useLayoutEffect, useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getPieceGeometry } from "./pieceGeometry";

// ── shared materials (built once, reused by every piece) ───────────────────
// Ivory and walnut — neither pure white nor pure black — with a lacquered
// clearcoat. Selected pieces swap to a pre-built variant with a faint warm
// glow, so selection never allocates a material.
const BASE = {
  w: { color: "#e3d2b0", roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.22, sheen: 0.25, sheenColor: "#fff3dc", sheenRoughness: 0.6 },
  b: { color: "#3b2416", roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.18, sheen: 0.2, sheenColor: "#8a5a3a", sheenRoughness: 0.5 },
};
const materials = { w: null, b: null, wSel: null, bSel: null };

function getMaterial(color, selected) {
  const key = selected ? `${color}Sel` : color;
  if (!materials[key]) {
    const m = new THREE.MeshPhysicalMaterial({ ...BASE[color], metalness: 0, envMapIntensity: 1 });
    if (selected) {
      m.emissive = new THREE.Color("#f6c445");
      m.emissiveIntensity = color === "w" ? 0.1 : 0.16;
    }
    materials[key] = m;
  }
  return materials[key];
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// One chess piece. Moves glide along a lift-and-drop arc when `x`/`z` change;
// the selected piece floats slightly; a `dying` piece (just captured) fades,
// sinks and shrinks, then calls `onGone`. All per-frame work mutates refs —
// nothing is allocated inside useFrame.
export default function Piece3D({ type, color, x, z, selected, dying, appear, onGone, onClick }) {
  const group = useRef();
  const a = useRef({ fromX: x, fromZ: z, toX: x, toZ: z, t: 1, dur: 0.4, arc: 0, hover: 0, fade: 1, grow: appear ? 0 : 1, gone: false });

  // New target square → start a move from wherever the piece currently is.
  useLayoutEffect(() => {
    const s = a.current;
    if (s.toX === x && s.toZ === z) return;
    const g = group.current;
    s.fromX = g ? g.position.x : s.toX;
    s.fromZ = g ? g.position.z : s.toZ;
    s.toX = x;
    s.toZ = z;
    const dist = Math.hypot(s.toX - s.fromX, s.toZ - s.fromZ);
    s.dur = Math.min(0.62, 0.3 + dist * 0.06);
    s.arc = Math.min(0.75, 0.22 + dist * 0.09) + (type === "n" ? 0.15 : 0);
    s.t = 0;
  }, [x, z, type]);

  // Captured: fade with a private transparent clone (made once, at capture).
  const fadeMat = useMemo(() => {
    if (!dying) return null;
    const m = getMaterial(color, false).clone();
    m.transparent = true;
    m.depthWrite = false;
    return m;
  }, [dying, color]);
  useEffect(() => () => fadeMat?.dispose(), [fadeMat]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const s = a.current;
    const step = Math.min(dt, 0.05);

    let arcY = 0;
    if (s.t < 1) {
      s.t = Math.min(1, s.t + step / s.dur);
      const e = easeInOut(s.t);
      g.position.x = s.fromX + (s.toX - s.fromX) * e;
      g.position.z = s.fromZ + (s.toZ - s.fromZ) * e;
      arcY = Math.sin(Math.PI * e) * s.arc;
    } else {
      g.position.x = s.toX;
      g.position.z = s.toZ;
    }

    const hoverTarget = selected ? 0.16 : 0;
    s.hover += (hoverTarget - s.hover) * Math.min(1, step * 12);
    const bob = selected ? Math.sin(state.clock.elapsedTime * 3) * 0.012 : 0;
    g.position.y = arcY + s.hover + bob;

    if (s.grow < 1) {
      s.grow = Math.min(1, s.grow + step / 0.3);
      const k = 0.6 + 0.4 * easeInOut(s.grow);
      g.scale.set(k, k, k);
    }

    if (dying && !s.gone) {
      s.fade = Math.max(0, s.fade - step / 0.5);
      const mesh = g.children[0];
      if (mesh && mesh.material.transparent) mesh.material.opacity = s.fade;
      const k = 0.75 + 0.25 * s.fade;
      g.scale.set(k, k, k);
      g.position.y -= (1 - s.fade) * 0.25;
      if (s.fade <= 0) {
        s.gone = true;
        g.visible = false;
        onGone?.();
      }
    }
  });

  // Knights face the opponent, turned a little so the head shows in profile.
  const rotY = type === "n" ? (color === "w" ? Math.PI / 2 - 0.5 : -Math.PI / 2 - 0.5) : 0;

  return (
    <group ref={group} position={[x, 0, z]}>
      <mesh
        geometry={getPieceGeometry(type)}
        material={fadeMat || getMaterial(color, selected)}
        rotation={[0, rotY, 0]}
        castShadow={!dying}
        receiveShadow
        onClick={dying ? undefined : onClick}
      />
    </group>
  );
}
