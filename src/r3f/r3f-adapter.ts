import { context } from "@react-three/fiber";
import type { Object3D } from "three";

import type { HostAdapter } from "../host-adapter.ts";
import { R3fItem, R3fSlot } from "./r3f-hosts.tsx";

/** r3f host binding: slot and content hosts are groups. */
export const r3fAdapter: HostAdapter<Object3D> = {
  Slot: R3fSlot,
  Item: R3fItem,
  attach(host, parent, before) {
    if (host.parent !== parent) parent.add(host);
    const children = parent.children;
    children.splice(children.indexOf(host), 1);
    const index = before === null ? -1 : children.indexOf(before);
    children.splice(index === -1 ? children.length : index, 0, host);
    host.updateMatrixWorld();
  },
  detach(host) {
    host.removeFromParent();
  },
  unbridged: [context],
};
