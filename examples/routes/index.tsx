import { createArrangement, Stage } from "@astralarium/react-stage";
import { r3fAdapter } from "@astralarium/react-stage/r3f";
import { Canvas, useThree } from "@react-three/fiber";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type PropsWithChildren, useEffect, useState } from "react";

import { Orb } from "#components/orb";
import { ORB_COLORS } from "#components/orb-colors";
import { Pedestal } from "#components/pedestal";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/")({
  component: LandingPageClient,
  pendingComponent: LandingPage,
  ssr: false,
});

/** Pedestal slots, left to right. */
const SLOTS = [0, 1, 2] as const;

/** Delay between orb rotations, in ms. */
const ROTATE_MS = 2000;

/** Spacing between pedestals, in world units. */
const SLOT_SPACING = 2.8;

/** World width the pedestal row needs: rings plus a margin. */
const ROW_WIDTH = SLOT_SPACING * 2 + 3;

/** Scales its children down to fit the row in a narrow viewport. */
function FitRow({ children }: PropsWithChildren) {
  const width = useThree((state) => state.viewport.width);
  return <group scale={Math.min(1, width / ROW_WIDTH)}>{children}</group>;
}

function LandingPage({ children }: PropsWithChildren) {
  return (
    <div className="isolate mt-[max(0rem,30svh-16rem)] flex h-[clamp(0rem,100svh-2.5rem,48rem)] flex-col items-center overflow-clip">
      <div className="mx-2 text-center">
        <h1 className="mt-6 text-[clamp(2.5rem,min(24svh-4rem,14svw),8rem)] font-bold [@media(max-height:400px)]:hidden [@media(max-width:250px)]:hidden">
          react-<span className="text-stage-accent">stage</span>
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-lg max-sm:hidden [@media(max-height:800px)]:hidden [@media(max-width:200px)]:hidden">
          Performant reparenting in React.
        </p>
      </div>

      <div className="-z-10 -mt-8 -mb-8 min-h-0 w-full grow">{children}</div>

      <div className="mb-4 flex gap-4 pb-4 [@media(max-width:200px)]:flex-col">
        <Button size="lg" render={<a href="/react-stage/docs/" />}>
          Docs
        </Button>
        <Button size="lg" variant="outline" render={<Link to="/example" />}>
          Examples
        </Button>
      </div>
    </div>
  );
}

/** Three orbs rotate between pedestals; clicked colors stay with the orb. */
function LandingPageClient() {
  const [arrangement] = useState(() => {
    const arrangement = createArrangement<string, number>();
    arrangement.batch(() => {
      ORB_COLORS.forEach((color, slot) => arrangement.add(color, slot));
    });
    return arrangement;
  });
  useEffect(() => {
    const interval = setInterval(() => {
      arrangement.batch(() => {
        for (const orb of ORB_COLORS) {
          const slot = arrangement.slotOf(orb) ?? 0;
          arrangement.move(orb, (slot + 1) % SLOTS.length);
        }
      });
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [arrangement]);

  return (
    <LandingPage>
      <Canvas camera={{ position: [0, 0, 7] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={2} />
        <Stage adapter={r3fAdapter} arrangement={arrangement} render={Orb}>
          <FitRow>
            {SLOTS.map((slot) => (
              <Pedestal
                key={slot}
                id={slot}
                position={[(slot - 1) * SLOT_SPACING, 0.2, 0]}
              />
            ))}
          </FitRow>
        </Stage>
      </Canvas>
    </LandingPage>
  );
}
