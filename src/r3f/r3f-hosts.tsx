import type { AttachFnType } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { Object3D } from "three";

interface R3fSlotProps {
  onHost: (host: Object3D | null) => void;
  hidden?: boolean;
}

/** Stops scene raycasts at the backstage host; three's raycast ignores
 *  `visible`. r3f events raycast objects directly, so offstage content
 *  checks `useOffstage`. */
const skipRaycast = () => false;

/** A group slot host; `hidden` stops rendering and raycasts. */
export function R3fSlot({ onHost, hidden }: R3fSlotProps) {
  return (
    <group
      visible={hidden !== true}
      {...(hidden && { raycast: skipRaycast })}
      ref={(group) => {
        onHost(group);
        return () => onHost(null);
      }}
    />
  );
}

interface R3fItemProps {
  onHost: (host: Object3D | null) => void;
  children?: ReactNode;
}

/** A content group whose `attach` hands it to the stage, so the renderer
 *  never parents it. */
export function R3fItem({ onHost, children }: R3fItemProps) {
  // r3f keeps the mount-time `attach`; it reads the latest `onHost`.
  const latest = useRef(onHost);
  useLayoutEffect(() => {
    latest.current = onHost;
  });
  // Runs on each (re)attach, unhide included; cleanup on unmount and hide.
  const attach: AttachFnType<Object3D> = (_parent, host) => {
    latest.current(host);
    return () => latest.current(null);
  };
  return <group attach={attach}>{children}</group>;
}
