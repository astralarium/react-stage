import {
  type ComponentType,
  memo,
  type ReactNode,
  use,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { type ArrangementOp, diffSnapshots } from "./arrangement.ts";
import { DEV, warn } from "./dev.ts";
import type { HostAdapter } from "./host-adapter.ts";
import {
  StageContext,
  type StageFixed,
  StageItemContext,
  type StagePlugin,
  type StageProps,
  type StageValue,
  useStageValue,
} from "./stage-context.ts";
import { type ItemProps, StageStore } from "./stage-store.ts";

/**
 * Renders every placed item once, keyed, and attaches each item's
 * content host under its slot's host. Moves re-parent hosts; items keep
 * their fibers and state.
 */
export function Stage<Key extends string | number, SlotId, Host>({
  adapter,
  arrangement,
  render,
  bridge,
  unbridged,
  plugins,
  contextProbe,
  children,
}: StageProps<Key, SlotId, Host>) {
  const [fixed] = useState<StageFixed>(() => ({
    adapter: adapter as HostAdapter<unknown>,
    bridge: bridge ?? [],
    known: new Set([
      StageContext,
      StageItemContext,
      ...(bridge ?? []),
      ...(unbridged ?? []),
      ...(adapter.unbridged ?? []),
      ...(plugins ?? []).flatMap((plugin) => plugin.unbridged ?? []),
    ]),
    plugins: (plugins ?? []) as readonly StagePlugin<never>[],
    probe: DEV ? contextProbe : undefined,
  }));
  const [store] = useState(() => new StageStore<Key, SlotId, Host>(adapter));

  useLayoutEffect(() => {
    let active = true;
    const check = () => {
      if (!DEV || !active) return;
      const expected = arrangement.snapshot?.();
      if (!expected) return;
      const diff = diffSnapshots(expected, store.snapshot());
      if (diff.length > 0) {
        warn(`mirror drifted from its arrangement:\n${diff.join("\n")}`);
      }
    };
    // Batches emitted from listeners deliver after the current one; the
    // check waits for them.
    let checkQueued = false;
    const queueCheck = () => {
      if (!DEV || checkQueued) return;
      checkQueued = true;
      queueMicrotask(() => {
        checkQueued = false;
        check();
      });
    };
    // Batches arriving while the replay applies queue behind it.
    let pending: (readonly ArrangementOp<Key, SlotId>[])[] | null = [];
    const unsubscribe = arrangement.subscribe((batch) => {
      if (pending) {
        pending.push(batch);
        return;
      }
      store.applyBatch(batch);
      queueCheck();
    });
    // The replay diffs against the kept mirror: a resubscribe (StrictMode,
    // Activity, a new arrangement) moves only what differs.
    const replay = pending.flat();
    pending = [];
    store.resync(replay);
    for (let next = pending.shift(); next; next = pending.shift()) {
      store.applyBatch(next);
    }
    pending = null;
    check();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, arrangement]);

  const value: StageValue = {
    store: store as StageStore<unknown, unknown, unknown>,
    fixed,
    render: render as ComponentType<ItemProps<never>> | undefined,
  };

  let items: ReactNode = <StageItems />;
  for (const plugin of fixed.plugins.toReversed()) {
    const List = plugin.List;
    if (List) items = <List>{items}</List>;
  }

  const Probe = fixed.probe;
  return (
    <StageContext value={value}>
      {Probe && <Probe onMap={store.setStageContexts} />}
      {children}
      {items}
    </StageContext>
  );
}

function StageItems() {
  const { store, fixed } = useStageValue();
  const keys = useSyncExternalStore(store.subscribeKeys, store.getKeys);
  useLayoutEffect(() => store.committed(), [store, keys]);
  const Backstage = fixed.adapter.Slot;
  return (
    <>
      <Backstage onHost={store.setBackstage} hidden />
      {(keys as readonly (string | number)[]).map((key) => (
        <ItemBridge key={key} itemKey={key} />
      ))}
    </>
  );
}

/** One item: its slot's bridged contexts, content host, plugin wrappers
 *  and render. Renders on its own slot or slot-view changes. */
function ItemBridgeImpl({ itemKey }: ItemBridgeProps) {
  const value = useStageValue();
  const { store, fixed } = value;
  const callbacks = store.itemCallbacks(itemKey);
  const view = useSyncExternalStore(callbacks.subscribe, () =>
    store.itemView(itemKey),
  );
  // Stage-level values serve items whose slot is unmounted.
  const inherited = fixed.bridge.map((context) => use(context) as unknown);
  const Render = view.view ? (view.view.render ?? value.render) : value.render;

  let content: ReactNode = Render ? (
    <Render itemKey={itemKey as never} />
  ) : null;
  for (const plugin of fixed.plugins.toReversed()) {
    const Wrap = plugin.Item;
    if (Wrap) content = <Wrap itemKey={itemKey as never}>{content}</Wrap>;
  }
  const Host = fixed.adapter.Item;
  content = (
    <StageItemContext value={{ store, key: itemKey }}>
      <Host onHost={callbacks.onHost}>{content}</Host>
    </StageItemContext>
  );
  const values = view.view?.values ?? inherited;
  for (let i = fixed.bridge.length - 1; i >= 0; i--) {
    const Bridged = fixed.bridge[i];
    content = <Bridged value={values[i]}>{content}</Bridged>;
  }
  return content;
}

interface ItemBridgeProps {
  itemKey: unknown;
}

const ItemBridge = memo(ItemBridgeImpl);

export interface SlotProps<Key, SlotId, Data = unknown> {
  id: SlotId;
  /** Renders this slot's items in place of the stage's `render`. */
  render?: ComponentType<ItemProps<Key>>;
  /** Read by items through {@link useItemSlot}. */
  data?: Data;
}

/**
 * A host items attach under. Captures the stage's bridged contexts for
 * its items; nests anywhere under the stage, item content included.
 */
export function Slot<Key, SlotId, Data = unknown>({
  id,
  render,
  data,
}: SlotProps<Key, SlotId, Data>) {
  const { store, fixed } = useStageValue();
  const item = use(StageItemContext);
  const owner = item?.store === store ? item.key : undefined;
  const [token] = useState(() => ({}));
  const values = fixed.bridge.map((context) => use(context) as unknown);

  useLayoutEffect(
    () => store.registerSlot(id, token, owner),
    [store, id, token, owner],
  );
  useLayoutEffect(() => {
    store.updateSlot(
      id,
      token,
      owner,
      values,
      render as ComponentType<ItemProps<never>> | undefined,
      data,
    );
  });

  const Host = fixed.adapter.Slot;
  const Probe = fixed.probe;
  return (
    <>
      {Probe && (
        <Probe onMap={(map) => store.checkSlotContexts(id, map, fixed.known)} />
      )}
      <Host onHost={(host) => store.setSlotHost(id, token, owner, host)} />
    </>
  );
}
