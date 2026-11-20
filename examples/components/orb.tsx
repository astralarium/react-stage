import type { ItemProps } from "@astralarium/react-stage";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Mesh } from "three";

import { ORB_COLORS, type OrbColor } from "#components/orb-colors";

/**
 * Spinning orb. Clicking cycles its color.
 * Color and spin are orb state: they survive moves between slots.
 */
export function Orb({ itemKey }: ItemProps<string>) {
  const mesh = useRef<Mesh>(null);
  const [color, setColor] = useState(() =>
    Math.max(0, ORB_COLORS.indexOf(itemKey as OrbColor)),
  );
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.x += delta * 0.3;
    mesh.current.rotation.y += delta * 0.5;
  });

  return (
    <mesh
      ref={mesh}
      scale={hovered ? 1.1 : 1}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={() => setColor((color + 1) % ORB_COLORS.length)}
    >
      <icosahedronGeometry />
      <meshStandardMaterial color={ORB_COLORS[color]} flatShading />
    </mesh>
  );
}
