import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getBoardTexture, getFrameTexture, getBoardSurfaceMaps } from "./boardTexture";
import Piece3D from "./Piece3D";
import "./chess3d.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const HDR_URL = `${import.meta.env.BASE_URL}hdr/studio.hdr`;

function squareToWorld(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  return [file - 3.5, 3.5 - rank];
}

// ── shared, module-level geometries (never rebuilt) ────────────────────────
const SHARED = {
  square: new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
  dot: new THREE.CircleGeometry(0.14, 32).rotateX(-Math.PI / 2),
  ring: new THREE.RingGeometry(0.38, 0.46, 48).rotateX(-Math.PI / 2),
  board: new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
  hit: new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
  table: new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
};

// Bevelled one-piece wooden frame: a square ring extruded downward with a
// rounded bevel on every edge.
let frameGeo = null;
function getFrameGeometry() {
  if (frameGeo) return frameGeo;
  const outer = 4.6;
  const inner = 4.04;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer); shape.lineTo(-outer, outer); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner); hole.lineTo(-inner, inner); hole.lineTo(inner, inner); hole.lineTo(inner, -inner); hole.closePath();
  shape.holes.push(hole);
  frameGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.26, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 1,
  });
  frameGeo.rotateX(-Math.PI / 2); // extrude axis → +Y
  frameGeo.translate(0, -0.27, 0); // top face sits just above the playing surface
  return frameGeo;
}

// ── environment: HDR → PMREM for reflections (RoomEnvironment fallback) ────
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    let envMap = null;
    let cancelled = false;
    const apply = (rt) => {
      if (cancelled) { rt.dispose(); return; }
      envMap = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.38;
    };
    new HDRLoader().load(
      HDR_URL,
      (hdr) => { apply(pmrem.fromEquirectangular(hdr)); hdr.dispose(); pmrem.dispose(); },
      undefined,
      () => { apply(pmrem.fromScene(new RoomEnvironment(), 0.04)); pmrem.dispose(); },
    );
    return () => {
      cancelled = true;
      if (scene.environment === envMap?.texture) scene.environment = null;
      envMap?.dispose();
    };
  }, [gl, scene]);
  return null;
}

// ── highlights ─────────────────────────────────────────────────────────────
function Highlight({ x, z, color, opacity = 0.35, geometry = SHARED.square, pulse = false }) {
  const matRef = useRef();
  useFrame(({ clock }) => {
    if (pulse && matRef.current) matRef.current.opacity = opacity * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 3.2));
  });
  return (
    <mesh geometry={geometry} position={[x, 0.004, z]} renderOrder={1}>
      <meshBasicMaterial
        ref={matRef} color={color} transparent opacity={opacity} depthWrite={false}
        polygonOffset polygonOffsetFactor={-2} toneMapped={false}
      />
    </mesh>
  );
}

// ── piece identity tracking (so moves can animate) ─────────────────────────
// chess.js gives us a fresh board every position; to animate we need to know
// which piece went where. Pure function: previous tracked list + new board →
// new tracked list (with stable ids) + the pieces that disappeared (captures).
function trackPieces(prev, board, lastMove) {
  if (!prev) return { list: board.map((p, i) => ({ ...p, id: i, appear: false })), captured: [], nextId: board.length };
  let nextId = prev.reduce((m, p) => Math.max(m, p.id), -1) + 1;
  const left = new Map(prev.map((p) => [p.square, p]));
  const out = new Array(board.length);
  const pending = [];

  board.forEach((p, i) => {
    const q = left.get(p.square);
    if (q && q.type === p.type && q.color === p.color) { out[i] = { ...p, id: q.id, appear: false }; left.delete(p.square); }
    else pending.push(i);
  });
  const take = (i, q) => { out[i] = { ...board[i], id: q.id, appear: false }; left.delete(q.square); };
  // 1) the move just played (covers promotion: pawn → queen keeps its id)
  if (lastMove) {
    const i = pending.find((k) => board[k].square === lastMove.to);
    const q = left.get(lastMove.from);
    if (i !== undefined && q && q.color === board[i].color) take(i, q);
  }
  // 2) anything else (castling rook, undo, new game): nearest same piece
  for (const i of pending) {
    if (out[i]) continue;
    const p = board[i];
    const [px, pz] = squareToWorld(p.square);
    let best = null;
    let bestD = Infinity;
    for (const q of left.values()) {
      if (q.color !== p.color || q.type !== p.type) continue;
      const [qx, qz] = squareToWorld(q.square);
      const d = (px - qx) ** 2 + (pz - qz) ** 2;
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best) take(i, best);
    else { out[i] = { ...p, id: nextId, appear: true }; nextId += 1; }
  }
  return { list: out, captured: [...left.values()], nextId };
}

// ── scene ──────────────────────────────────────────────────────────────────
function Scene({ chess, lastMove, selected, legalTargets, onSquareClick, interactive, inCheck }) {
  const boardTex = useMemo(() => getBoardTexture(), []);
  const surface = useMemo(() => getBoardSurfaceMaps(), []);
  const frameTex = useMemo(() => {
    const t = getFrameTexture().clone();
    t.repeat.set(0.12, 0.5);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => frameTex.dispose(), [frameTex]);

  // `chess` is mutated in place, so fen() is the signal that the position changed.
  const fen = chess.fen();
  const board = useMemo(() => {
    const list = [];
    chess.board().forEach((row) => row.forEach((cell) => { if (cell) list.push(cell); }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, fen]);

  const trackedRef = useRef(null);
  const tracked = useMemo(
    () => trackPieces(trackedRef.current, board, lastMove),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board],
  );
  const [dying, setDying] = useState([]);
  useLayoutEffect(() => {
    if (trackedRef.current === tracked.list) return;
    trackedRef.current = tracked.list;
    if (tracked.captured.length) {
      setDying((d) => [...d, ...tracked.captured.map((p) => ({ ...p, key: `x${p.id}-${fen}` }))]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked]);
  const removeDying = useCallback((key) => setDying((d) => d.filter((p) => p.key !== key)), []);

  const checkSquare = useMemo(() => {
    if (!inCheck) return null;
    const turn = chess.turn();
    const k = board.find((p) => p.type === "k" && p.color === turn);
    return k ? k.square : null;
  }, [chess, inCheck, board]);

  // One invisible plane catches all board clicks; the square comes from the hit point.
  const boardGroup = useRef();
  const [hoverSquare, setHoverSquare] = useState(null);
  useCursor(Boolean(hoverSquare) && interactive);
  const squareFromEvent = (e) => {
    const p = boardGroup.current.worldToLocal(e.point.clone());
    const f = Math.floor(p.x + 4);
    const r = Math.floor(4 - p.z);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  };

  const occupied = useMemo(() => new Set(board.map((p) => p.square)), [board]);

  return (
    <group ref={boardGroup}>
      {/* lights: warm key with soft shadows, cool fill, sky/ground bounce */}
      <hemisphereLight args={["#fff4e2", "#2a1a0e", 0.2]} />
      <directionalLight
        position={[-6.5, 8, 3.5]}
        intensity={3.4}
        color="#fff1dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3}
        shadow-blurSamples={16}
        shadow-bias={-0.0002}
        shadow-normalBias={0.025}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={2}
        shadow-camera-far={25}
      />
      <directionalLight position={[7, 5, 5]} intensity={0.4} color="#d6e2ff" />

      {/* table under the board */}
      <mesh geometry={SHARED.table} position={[0, -0.33, 0]} receiveShadow>
        <meshStandardMaterial color="#1c130c" roughness={0.85} />
      </mesh>

      {/* bevelled wooden frame */}
      <mesh geometry={getFrameGeometry()} castShadow receiveShadow>
        <meshPhysicalMaterial map={frameTex} color="#b98a68" roughness={0.38} clearcoat={0.6} clearcoatRoughness={0.2} />
      </mesh>

      {/* playing surface: light/dark wood squares with normal + roughness maps */}
      <mesh geometry={SHARED.board} receiveShadow>
        <meshPhysicalMaterial
          map={boardTex}
          normalMap={surface.normalMap}
          normalScale={[0.35, 0.35]}
          roughnessMap={surface.roughnessMap}
          roughness={0.45}
          clearcoat={0.4}
          clearcoatRoughness={0.25}
        />
      </mesh>

      {/* click / hover catcher */}
      <mesh
        geometry={SHARED.hit}
        position={[0, 0.01, 0]}
        visible={false}
        onClick={(e) => { if (!interactive) return; e.stopPropagation(); const s = squareFromEvent(e); if (s) onSquareClick?.(s); }}
        onPointerMove={(e) => { if (!interactive) return; const s = squareFromEvent(e); if (s !== hoverSquare) setHoverSquare(s); }}
        onPointerOut={() => setHoverSquare(null)}
      />

      {lastMove && [lastMove.from, lastMove.to].map((sq) => {
        const [x, z] = squareToWorld(sq);
        return <Highlight key={`lm-${sq}`} x={x} z={z} color="#f2c14e" opacity={0.22} />;
      })}

      {interactive && hoverSquare && hoverSquare !== selected && (() => {
        const [x, z] = squareToWorld(hoverSquare);
        return <Highlight x={x} z={z} color="#ffffff" opacity={0.1} />;
      })()}

      {selected && (() => {
        const [x, z] = squareToWorld(selected);
        return <Highlight x={x} z={z} color="#f6d154" opacity={0.38} />;
      })()}

      {legalTargets?.map((sq) => {
        const [x, z] = squareToWorld(sq);
        const capture = occupied.has(sq);
        return (
          <Highlight
            key={`lt-${sq}`} x={x} z={z} color={capture ? "#ff8a4c" : "#2fd08a"}
            opacity={capture ? 0.75 : 0.6} geometry={capture ? SHARED.ring : SHARED.dot}
          />
        );
      })}

      {checkSquare && (() => {
        const [x, z] = squareToWorld(checkSquare);
        return <Highlight x={x} z={z} color="#ef4444" opacity={0.55} pulse />;
      })()}

      {tracked.list.map((p) => {
        const [x, z] = squareToWorld(p.square);
        return (
          <Piece3D
            key={p.id}
            type={p.type}
            color={p.color}
            x={x}
            z={z}
            appear={p.appear}
            selected={selected === p.square}
            onClick={interactive ? (e) => { e.stopPropagation(); onSquareClick?.(p.square); } : undefined}
          />
        );
      })}

      {dying.map((p) => {
        const [x, z] = squareToWorld(p.square);
        return <Piece3D key={p.key} type={p.type} color={p.color} x={x} z={z} dying onGone={() => removeDying(p.key)} />;
      })}
    </group>
  );
}

// Camera: FOV 40, behind the player's side at ~50° elevation.
const CAM_DIST = 16.2;
const CAM_ELEV = (50 * Math.PI) / 180;
const CAM_POS = [0, CAM_DIST * Math.sin(CAM_ELEV), CAM_DIST * Math.cos(CAM_ELEV)];

export default function Board3D({ chess, orientation = "w", ...rest }) {
  return (
    <div className="ca-board3d-wrap">
      <Canvas
        dpr={[1, 2]}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: CAM_POS, fov: 40, near: 0.5, far: 80 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.92;
        }}
      >
        <color attach="background" args={["#1a120b"]} />
        <fog attach="fog" args={["#1a120b", 20, 34]} />
        <StudioEnvironment />
        <group rotation={[0, orientation === "b" ? Math.PI : 0, 0]}>
          <Suspense fallback={null}>
            <Scene chess={chess} {...rest} />
          </Suspense>
        </group>
        <OrbitControls
          target={[0, -0.2, 0.55]}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.6}
          minDistance={11}
          maxDistance={21}
          minPolarAngle={0.3}
          maxPolarAngle={1.2}
        />
      </Canvas>
    </div>
  );
}
