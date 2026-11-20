import {
  use,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { StageItemContext, useStageValue } from "./stage-context.ts";
import type {
  ItemSlot,
  ItemView,
  StageEvents,
  StageHandle,
} from "./stage-store.ts";

/** The stage's arrangement and hosts. */
export function useStage<Key, SlotId, Host>(): StageHandle<Key, SlotId, Host> {
  return useStageValue().store as unknown as StageHandle<Key, SlotId, Host>;
}

/** Reads whether the enclosing stage item sits offstage; call the
 *  getter at act time (raycast, handler). */
export function useOffstage(): () => boolean {
  const item = use(StageItemContext);
  if (!item) throw new Error("useOffstage needs a stage item");
  const { store, key } = item;
  return () => store.offstage(key);
}

/** Subscribes `listener` to the stage's move, enter and settle events. */
export function useStageEvents<Key, SlotId, Host>(
  listener: StageEvents<Key, SlotId, Host>,
) {
  const { store } = useStageValue();
  const onMove = useEffectEvent<NonNullable<typeof listener.onMove>>(
    (...args) => listener.onMove?.(...args),
  );
  const onEnter = useEffectEvent<NonNullable<typeof listener.onEnter>>(
    (key, slot) => listener.onEnter?.(key, slot),
  );
  const onSettle = useEffectEvent<NonNullable<typeof listener.onSettle>>(
    (slots) => listener.onSettle?.(slots),
  );
  useLayoutEffect(
    () =>
      store.subscribe({
        onMove: (key, from, to) =>
          onMove(key as Key, from as never, to as never),
        onEnter: (key, slot) => onEnter(key as Key, slot as never),
        onSettle: (slots) => onSettle(slots as ReadonlySet<SlotId>),
      }),
    [store],
  );
}

/** `key`'s slot and slot data; `selector` narrows what re-renders. */
export function useItemSlot<SlotId, Data = unknown>(
  key: unknown,
): ItemSlot<SlotId, Data>;
export function useItemSlot<SlotId, Data, T>(
  key: unknown,
  selector: (slot: ItemSlot<SlotId, Data>) => T,
): T;
export function useItemSlot<SlotId, Data, T>(
  key: unknown,
  selector?: (slot: ItemSlot<SlotId, Data>) => T,
): T | ItemSlot<SlotId, Data> {
  const { store } = useStageValue();
  const cache = useRef<{
    view: ItemView<unknown> | null;
    selector: unknown;
    value: unknown;
  }>({ view: null, selector: null, value: undefined });
  return useSyncExternalStore(store.itemCallbacks(key).subscribe, () => {
    const view = store.itemView(key);
    if (!selector) return view as ItemSlot<SlotId, Data>;
    const state = cache.current;
    if (state.view !== view || state.selector !== selector) {
      state.view = view;
      state.selector = selector;
      state.value = selector(view as ItemSlot<SlotId, Data>);
    }
    return state.value as T;
  });
}
