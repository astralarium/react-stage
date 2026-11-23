import { type ComponentType, createContext, type ReactNode, use } from "react";

import type { Arrangement } from "./arrangement.ts";
import type { AnyContext, HostAdapter } from "./host-adapter.ts";
import type { ItemProps, StageStore } from "./stage-store.ts";

/** Wrappers a plugin adds to every stage. */
export interface StagePlugin<Key> {
  /** Wraps each item inside its bridge and content host. */
  Item?: ComponentType<{ itemKey: Key; children?: ReactNode }>;
  /** Wraps the item list. */
  List?: ComponentType<{ children?: ReactNode }>;
  /** Contexts the plugin provides; the dev context check skips them. */
  unbridged?: readonly AnyContext[];
}

/** Renderer-agnostic component reporting every context value above it
 *  (its-fine's `useContextMap`). */
export type ContextProbe = ComponentType<{
  onMap: (map: ReadonlyMap<AnyContext, unknown>) => void;
}>;

/** Stage props. Keys double as React keys, so they stay distinct as
 *  strings. Only `arrangement`, `render` and `children` may change. */
export interface StageProps<Key extends string | number, SlotId, Host> {
  adapter: HostAdapter<Host>;
  arrangement: Arrangement<Key, SlotId>;
  /** Renders each item; a slot's `render` overrides it there. */
  render?: ComponentType<ItemProps<Key>>;
  /** Contexts each item reads from its slot. */
  bridge?: readonly AnyContext[];
  /** Contexts the dev context check skips. */
  unbridged?: readonly AnyContext[];
  /** Earlier plugins wrap later ones. */
  plugins?: readonly StagePlugin<Key>[];
  /** Enables the dev context check. */
  contextProbe?: ContextProbe;
  children?: ReactNode;
}

export interface StageFixed {
  adapter: HostAdapter<unknown>;
  bridge: readonly AnyContext[];
  /** Contexts the check skips: bridged and unbridged. */
  known: ReadonlySet<AnyContext>;
  plugins: readonly StagePlugin<never>[];
  probe: ContextProbe | undefined;
}

export interface StageValue {
  store: StageStore<unknown, unknown, unknown>;
  fixed: StageFixed;
  render: ComponentType<ItemProps<never>> | undefined;
}

export const StageContext = createContext<StageValue | null>(null);

/** The item whose content renders here. */
export const StageItemContext = createContext<{
  store: StageStore<unknown, unknown, unknown>;
  key: unknown;
} | null>(null);

export function useStageValue(): StageValue {
  const value = use(StageContext);
  if (!value) throw new Error("Stage hooks and <Slot> need a <Stage>");
  return value;
}
