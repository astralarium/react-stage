import { FiberProvider, useContextMap } from "its-fine";
import { useLayoutEffect, useRef } from "react";

import type { AnyContext } from "../host-adapter.ts";

/** Props of {@link ContextProbe}. */
export interface ContextProbeProps {
  /** Receives the context map above the probe. */
  onMap: (map: ReadonlyMap<AnyContext, unknown>) => void;
}

/** Reports the contexts above it, as of each change. Supplies its own
 *  `FiberProvider`: its-fine finds the probe's fiber below the provider,
 *  then walks every ancestor. */
export function ContextProbe({ onMap }: ContextProbeProps) {
  return (
    <FiberProvider>
      <MapReport onMap={onMap} />
    </FiberProvider>
  );
}

function MapReport({ onMap }: ContextProbeProps) {
  // its-fine refills one Map in place each render.
  const map = useContextMap();
  const last = useRef<[AnyContext, unknown][] | null>(null);
  useLayoutEffect(() => {
    const entries = [...map];
    const prev = last.current;
    if (
      prev?.length === entries.length &&
      prev.every(
        ([context, value], i) =>
          entries[i][0] === context && Object.is(entries[i][1], value),
      )
    ) {
      return;
    }
    last.current = entries;
    onMap(new Map(entries));
  });
  return null;
}
