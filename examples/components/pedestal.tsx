import { Slot } from "@astralarium/react-stage";

interface PedestalProps<SlotId> {
  id: SlotId;
  position: [number, number, number];
}

/** A stage slot marked by a ring beneath it. */
export function Pedestal<SlotId>({ id, position }: PedestalProps<SlotId>) {
  return (
    <group position={position}>
      <mesh position={[0, -1.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1, 0.05, 12, 48]} />
        <meshStandardMaterial color="#fbbf24" />
      </mesh>
      <Slot id={id} />
    </group>
  );
}
