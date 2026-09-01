import React, { useMemo } from "react";
import * as THREE from "three";
import {
  getBodyGeometry, getRookMerlons, getRookTopCap, getQueenSpikes, getBishopBall, getKingCross, getKnightGeometry,
} from "./pieceGeometry";

const materialCache = new Map();

function getMaterial(color) {
  if (materialCache.has(color)) return materialCache.get(color);
  const mat = color === "w"
    ? new THREE.MeshPhysicalMaterial({ color: "#e6d3a8", roughness: 0.42, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.35 })
    : new THREE.MeshPhysicalMaterial({ color: "#4a2f1a", roughness: 0.4, metalness: 0.02, clearcoat: 0.28, clearcoatRoughness: 0.32 });
  materialCache.set(color, mat);
  return mat;
}

const accentGold = new THREE.MeshStandardMaterial({ color: "#caa24a", roughness: 0.3, metalness: 0.55 });

export default function Piece3D({ type, color, x, z, lifted, glow }) {
  const material = getMaterial(color);
  const y = lifted ? 0.16 : 0;

  const extras = useMemo(() => {
    if (type === "r") return getRookMerlons();
    if (type === "q") return getQueenSpikes();
    if (type === "b") return getBishopBall();
    if (type === "k") return getKingCross();
    return null;
  }, [type]);

  if (type === "n") {
    const { baseGeo, headGeo, headY } = getKnightGeometry();
    return (
      <group position={[x, y, z]} rotation={[0, color === "w" ? 0 : Math.PI, 0]} castShadow>
        <mesh geometry={baseGeo} material={material} castShadow receiveShadow />
        <mesh geometry={headGeo} material={material} position={[0, headY, 0]} castShadow receiveShadow />
        {glow && <pointLight color="#f6d154" intensity={0.6} distance={0.9} position={[0, 0.5, 0]} />}
      </group>
    );
  }

  const bodyGeo = getBodyGeometry(type);

  return (
    <group position={[x, y, z]} castShadow>
      <mesh geometry={bodyGeo} material={material} castShadow receiveShadow />
      {type === "r" && (
        <mesh geometry={getRookTopCap().geo} material={material} position={[0, getRookTopCap().y, 0]} />
      )}
      {type === "r" && extras && extras.transforms.map((t, i) => (
        <mesh key={i} geometry={extras.geo} material={material} position={[t.x, t.y, t.z]} castShadow />
      ))}
      {type === "q" && extras && extras.transforms.map((t, i) => (
        <mesh key={i} geometry={extras.geo} material={accentGold} position={[t.x, t.y, t.z]} castShadow />
      ))}
      {type === "b" && extras && (
        <mesh geometry={extras.geo} material={material} position={[0, extras.y, 0]} castShadow />
      )}
      {type === "k" && extras && (
        <group position={[0, extras.y, 0]}>
          <mesh geometry={extras.vertical} material={accentGold} castShadow />
          <mesh geometry={extras.horizontal} material={accentGold} position={[0, 0.045, 0]} castShadow />
        </group>
      )}
      {glow && <pointLight color="#f6d154" intensity={0.6} distance={0.9} position={[0, 0.5, 0]} />}
    </group>
  );
}
