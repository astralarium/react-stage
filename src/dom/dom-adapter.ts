import type { HostAdapter } from "../host-adapter.ts";
import { DomItem, DomSlot } from "./dom-hosts.tsx";

/** `Element.moveBefore`: a state-preserving move between connected
 *  parents. */
type MovingParent = HTMLElement & {
  moveBefore(node: Node, child: Node | null): void;
};

function canMove(host: HTMLElement, parent: HTMLElement): boolean {
  return (
    host.isConnected &&
    parent.isConnected &&
    host.getRootNode() === parent.getRootNode() &&
    "moveBefore" in parent
  );
}

/** DOM host binding: slots are `display: contents` divs; each item
 *  portals into a fixed container of its own. Moves keep focus inside
 *  the moved host. */
export const domAdapter: HostAdapter<HTMLElement> = {
  Slot: DomSlot,
  Item: DomItem,
  attach(host, parent, before) {
    if (canMove(host, parent)) {
      (parent as MovingParent).moveBefore(host, before);
      return;
    }
    const active = host.ownerDocument.activeElement;
    parent.insertBefore(host, before);
    if (
      active instanceof HTMLElement &&
      active !== host.ownerDocument.activeElement &&
      host.contains(active)
    ) {
      active.focus({ preventScroll: true });
    }
  },
  detach(host) {
    host.remove();
  },
};
