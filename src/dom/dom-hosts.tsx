import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Layout-neutral box: its children lay out in the enclosing element. */
const CONTENTS = { display: "contents" } as const;

interface HostReportProps {
  host: HTMLElement;
  onHost: (host: HTMLElement | null) => void;
}

/** Reports `host` before its sibling portal's effects run. */
function HostReport({ host, onHost }: HostReportProps) {
  useLayoutEffect(() => {
    onHost(host);
    return () => onHost(null);
  }, [host, onHost]);
  return null;
}

interface DomSlotProps {
  onHost: (host: HTMLElement | null) => void;
  hidden?: boolean;
}

/** A `display: contents` slot host; hidden, the backstage host. */
export function DomSlot({ onHost, hidden }: DomSlotProps) {
  return (
    <div
      hidden={hidden}
      style={hidden ? undefined : CONTENTS}
      ref={(element) => {
        onHost(element);
        return () => onHost(null);
      }}
    />
  );
}

interface DomItemProps {
  onHost: (host: HTMLElement | null) => void;
  children?: ReactNode;
}

/** Portals `children` into a fixed `display: contents` container. */
export function DomItem({ onHost, children }: DomItemProps) {
  const [container] = useState(() => {
    const element = document.createElement("div");
    Object.assign(element.style, CONTENTS);
    return element;
  });
  return (
    <>
      <HostReport host={container} onHost={onHost} />
      {createPortal(children, container)}
    </>
  );
}
