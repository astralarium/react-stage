import { createArrangement, Stage } from "@astralarium/react-stage";
import { r3fAdapter } from "@astralarium/react-stage/r3f";
import { Canvas } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Orb } from "#components/orb";
import { Pedestal } from "#components/pedestal";
import { Button } from "#components/ui/button";

import { Frame } from "./-frame";

export const Route = createFileRoute("/example/r3f")({
  component: R3fExample,
});

type Side = "left" | "right";

/** One orb, two slots, a move button. */
function R3fExample() {
  const [arrangement] = useState(() => {
    const arrangement = createArrangement<string, Side>();
    arrangement.add("orange", "left");
    return arrangement;
  });
  const move = () =>
    arrangement.move(
      "orange",
      arrangement.slotOf("orange") === "left" ? "right" : "left",
    );

  return (
    <Frame
      title="React Three Fiber"
      subtitle="Click the orb to change its color, then move it"
      sourceUrl="https://github.com/astralarium/react-stage/blob/main/examples/routes/example/r3f.tsx"
      controls={
        <Button size="sm" variant="outline" onClick={move}>
          Move orb
        </Button>
      }
    >
      <div className="relative min-h-0 flex-1">
        <Canvas camera={{ position: [0, 0, 6] }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[2, 4, 3]} intensity={2} />
          <Stage adapter={r3fAdapter} arrangement={arrangement} render={Orb}>
            <Pedestal id="left" position={[-2, 0.2, 0]} />
            <Pedestal id="right" position={[2, 0.2, 0]} />
          </Stage>
        </Canvas>
      </div>
    </Frame>
  );
}
