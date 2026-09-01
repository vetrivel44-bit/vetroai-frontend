import React, { useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useCursor, ContactShadows } from "@react-three/drei";
import { getBoardTexture } from "./boardTexture";
import Piece3D from "./Piece3D";
import "./chess3d.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareToWorld(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  return [file - 3.5, 3.5 - rank];
}

function InteractiveSquare({ square, x, z, interactive, onClick }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && interactive);
  return (
    <mesh
      position={[x, 0.012, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => { if (!interactive) return; e.stopPropagation(); onClick?.(square); }}
      onPointerOver={(e) => { if (!interactive) return; e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={[0.97, 0.97]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Highlight({ x, z, color, opacity = 0.35, shape = "square", size = 0.96, pulse = false }) {
  const matRef = useRef();
  useFrame(({ clock }) => {
    if (pulse && matRef.current) {
      matRef.current.opacity = opacity * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 3));
    }
  });
  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      {shape === "circle" && <circleGeometry args={[size, 32]} />}
      {shape === "ring" && <ringGeometry args={[size * 0.82, size, 32]} />}
      {shape === "square" && <planeGeometry args={[size, size]} />}
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Scene({ chess, lastMove, selected, legalTargets, onSquareClick, interactive, inCheck }) {
  const texture = useMemo(() => getBoardTexture(), []);

  // `chess` is a stable, mutated-in-place instance (see useChessGame in
  // ChessArena.jsx) — its identity never changes, so fen() is what actually
  // signals a new position for this memo to key off.
  const fen = chess.fen();
  const pieces = useMemo(() => {
    const list = [];
    chess.board().forEach((row) => row.forEach((cell) => { if (cell) list.push(cell); }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess, fen]);

  const checkSquare = useMemo(() => {
    if (!inCheck) return null;
    const turn = chess.turn();
    const found = pieces.find((p) => p.type === "k" && p.color === turn);
    return found ? found.square : null;
  }, [chess, inCheck, pieces]);

  const squares = useMemo(() => {
    const list = [];
    for (let f = 0; f < 8; f += 1) for (let r = 0; r < 8; r += 1) list.push(FILES[f] + (r + 1));
    return list;
  }, []);

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#fff3dd", "#241a10", 0.45]} />
      <directionalLight
        position={[4, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <directionalLight position={[-5, 4, -4]} intensity={0.3} />

      {/* frame */}
      <mesh position={[0, -0.11, 4.24]} receiveShadow castShadow>
        <boxGeometry args={[9, 0.22, 0.5]} />
        <meshStandardMaterial color="#2b1c10" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.11, -4.24]} receiveShadow castShadow>
        <boxGeometry args={[9, 0.22, 0.5]} />
        <meshStandardMaterial color="#2b1c10" roughness={0.5} />
      </mesh>
      <mesh position={[4.24, -0.11, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.5, 0.22, 9]} />
        <meshStandardMaterial color="#2b1c10" roughness={0.5} />
      </mesh>
      <mesh position={[-4.24, -0.11, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.5, 0.22, 9]} />
        <meshStandardMaterial color="#2b1c10" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.27, 0]} receiveShadow>
        <boxGeometry args={[9.7, 0.12, 9.7]} />
        <meshStandardMaterial color="#190f08" roughness={0.65} />
      </mesh>

      {/* board surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshPhysicalMaterial map={texture} roughness={0.3} clearcoat={0.32} clearcoatRoughness={0.28} />
      </mesh>

      {squares.map((square) => {
        const [x, z] = squareToWorld(square);
        return <InteractiveSquare key={square} square={square} x={x} z={z} interactive={interactive} onClick={onSquareClick} />;
      })}

      {selected && (() => {
        const [x, z] = squareToWorld(selected);
        return <Highlight x={x} z={z} color="#f6d154" opacity={0.32} />;
      })()}

      {lastMove && [lastMove.from, lastMove.to].map((sq) => {
        const [x, z] = squareToWorld(sq);
        return <Highlight key={sq} x={x} z={z} color="#f6d154" opacity={0.2} />;
      })}

      {legalTargets?.map((sq) => {
        const [x, z] = squareToWorld(sq);
        const occupied = pieces.some((p) => p.square === sq);
        return (
          <Highlight
            key={sq}
            x={x}
            z={z}
            color="#f6d154"
            opacity={0.6}
            shape={occupied ? "ring" : "circle"}
            size={occupied ? 0.44 : 0.13}
          />
        );
      })}

      {checkSquare && (() => {
        const [x, z] = squareToWorld(checkSquare);
        return <Highlight x={x} z={z} color="#ef4444" opacity={0.5} pulse />;
      })()}

      {pieces.map((p) => {
        const [x, z] = squareToWorld(p.square);
        return <Piece3D key={p.square} type={p.type} color={p.color} x={x} z={z} lifted={selected === p.square} />;
      })}

      <ContactShadows position={[0, -0.005, 0]} opacity={0.35} scale={10} blur={2} far={1.2} />
    </>
  );
}

export default function Board3D({ chess, orientation = "w", ...rest }) {
  return (
    <div className="ca-board3d-wrap">
      <Canvas shadows camera={{ position: [0, 8.1, 9.0], fov: 38 }} gl={{ antialias: true }}>
        <color attach="background" args={["#14100d"]} />
        <fog attach="fog" args={["#14100d", 14, 24]} />
        <group rotation={[0, orientation === "b" ? Math.PI : 0, 0]}>
          <Suspense fallback={null}>
            <Scene chess={chess} orientation={orientation} {...rest} />
          </Suspense>
        </group>
        <OrbitControls
          target={[0, 0, -0.35]}
          enablePan={false}
          minDistance={7}
          maxDistance={13}
          minPolarAngle={0.35}
          maxPolarAngle={0.62}
        />
      </Canvas>
    </div>
  );
}
