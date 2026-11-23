import type { ComponentType, Context, ReactNode } from "react";

/** A context of any value type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- contexts are invariant in their value
export type AnyContext = Context<any>;

/** Renderer binding: host components and host-tree edits. */
export interface HostAdapter<Host> {
  /** Renders a slot's host; calls `onHost` with it on mount and null on
   *  unmount. A `hidden` host keeps its children out of view. */
  Slot: ComponentType<{
    onHost: (host: Host | null) => void;
    hidden?: boolean;
  }>;
  /** Renders `children` into an item's content host; calls `onHost` with
   *  it once built and null once removed. */
  Item: ComponentType<{
    onHost: (host: Host | null) => void;
    children?: ReactNode;
  }>;
  /** Places `host` under `parent`, ahead of `before` (a child of
   *  `parent`), else last. */
  attach(host: Host, parent: Host, before: Host | null): void;
  /** Takes `host` out of its parent. */
  detach(host: Host): void;
  /** Renderer contexts; the dev context check skips them. */
  unbridged?: readonly AnyContext[];
}
