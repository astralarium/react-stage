import type { ComponentType } from "react";

import {
  type ArrangementChange,
  ArrangementMirror,
  type ArrangementOp,
  reconcileArrangement,
  replayOps,
} from "./arrangement.ts";
import { warn } from "./dev.ts";
import { dispatch } from "./dispatch.ts";
import type { AnyContext, HostAdapter } from "./host-adapter.ts";

/** Props of the component rendering one item. */
export interface ItemProps<Key> {
  itemKey: Key;
}

/** A slot as an item sees it. */
export interface ItemSlot<SlotId, Data = unknown> {
  /** The slot holding the item. */
  id: SlotId;
  /** The slot's `data`; an offstage item keeps its last slot's. */
  data: Data | undefined;
}

/** A slot and the host it had or has at a move. */
export interface SlotRef<SlotId, Host> {
  id: SlotId;
  /** The slot's host; null while the item sat offstage. */
  host: Host | null;
}

/** Stage move events. */
export interface StageEvents<Key, SlotId, Host> {
  /** `key`'s host moved under `to`. `from.host` keeps its transform, so
   *  it and the host's local transform give the prior world transform.
   *  Hostless items fire none. */
  onMove?(
    key: Key,
    from: SlotRef<SlotId, Host>,
    to: SlotRef<SlotId, Host>,
  ): void;
  /** `key`'s host entered `slot` outside a move: host mount, slot mount,
   *  or return from offstage. */
  onEnter?(key: Key, slot: SlotRef<SlotId, Host>): void;
  /** A batch's hosts are in place; `slots` lists reordered slots. Fires
   *  in batch order, after the commit of any added or removed items, so a
   *  hidden stage defers it to its reveal. */
  onSettle?(slots: ReadonlySet<SlotId>): void;
}

/** Read access to a stage's arrangement and hosts. */
export interface StageHandle<Key, SlotId, Host> {
  slotOf(key: Key): SlotId | undefined;
  /** Live view of `slot`'s order; it changes with later batches. */
  order(slot: SlotId): readonly Key[];
  itemHost(key: Key): Host | undefined;
  /** The slot's host while mounted. */
  slotHost(slot: SlotId): Host | undefined;
  /** Whether `key` is placed but out of view, itself or through the item
   *  holding its slot. */
  offstage(key: Key): boolean;
  /** Whether a batch that changed `slot`'s order has yet to settle. */
  settling(slot: SlotId): boolean;
  /** Returns an unsubscribe. */
  subscribe(listener: StageEvents<Key, SlotId, Host>): () => void;
}

/** What a mounted slot supplies to its items. */
interface SlotView {
  /** Bridged context values, in `bridge` order. */
  values: readonly unknown[];
  render: ComponentType<ItemProps<never>> | undefined;
  data: unknown;
}

/** A key's slot and its view; stable until either changes. An unmounted
 *  slot leaves its last view. */
export interface ItemView<SlotId> extends ItemSlot<SlotId> {
  view: SlotView | undefined;
}

interface SlotEntry<Key, Host> {
  /** The `<Slot>` instance owning this id. */
  token: object;
  host: Host | null;
  /** Item whose content holds the slot. */
  owner: Key | undefined;
  view: SlotView | undefined;
}

const BACKSTAGE = Symbol("backstage");

function sameValues(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** A stage's mirror, hosts and slots; attaches hosts as arrangement and
 *  mounts change. */
export class StageStore<Key, SlotId, Host> implements StageHandle<
  Key,
  SlotId,
  Host
> {
  readonly #adapter: HostAdapter<Host>;
  readonly #mirror = new ArrangementMirror<Key, SlotId>();
  #keys: readonly Key[] = [];
  readonly #keyListeners = new Set<() => void>();
  readonly #itemListeners = new Map<Key, Set<() => void>>();
  readonly #views = new Map<Key, ItemView<SlotId>>();
  /** Per-key callbacks with a stable identity. */
  readonly #itemCallbacks = new Map<
    Key,
    {
      subscribe: (fn: () => void) => () => void;
      onHost: (host: Host | null) => void;
    }
  >();
  /** Keys offstage for sitting in a slot inside themselves. */
  readonly #nestOffstage = new Set<Key>();
  readonly #hosts = new Map<Key, Host>();
  /** Where each host sits: a slot, backstage, or nowhere. */
  readonly #attached = new Map<Key, SlotId | typeof BACKSTAGE>();
  readonly #slots = new Map<SlotId, SlotEntry<Key, Host>>();
  #backstage: Host | null = null;
  readonly #listeners = new Set<StageEvents<Key, SlotId, Host>>();
  /** Settles waiting on the commit that mounts or unmounts items. */
  #pendingSettles: Set<SlotId>[] = [];
  /** Hosts that entered a slot, dispatched once placing finishes. */
  #enters: [Key, SlotRef<SlotId, Host>][] = [];
  readonly #warned = new Set<unknown>();

  constructor(adapter: HostAdapter<Host>) {
    this.#adapter = adapter;
  }

  slotOf(key: Key) {
    return this.#mirror.slotOf(key);
  }

  order(slot: SlotId) {
    return this.#mirror.order(slot);
  }

  snapshot() {
    return this.#mirror.snapshot();
  }

  itemHost(key: Key) {
    return this.#hosts.get(key);
  }

  slotHost(slot: SlotId) {
    return this.#slots.get(slot)?.host ?? undefined;
  }

  offstage(key: Key) {
    const seen = new Set<Key>();
    for (let k: Key | undefined = key; k !== undefined;) {
      const slot = this.#mirror.slotOf(k);
      if (slot === undefined) return false;
      if (seen.has(k) || this.#attached.get(k) !== slot) return true;
      seen.add(k);
      k = this.#slots.get(slot)?.owner;
    }
    return false;
  }

  settling(slot: SlotId) {
    return this.#pendingSettles.some((slots) => slots.has(slot));
  }

  subscribe = (listener: StageEvents<Key, SlotId, Host>) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  // --- React subscriptions

  getKeys = () => this.#keys;

  subscribeKeys = (fn: () => void) => {
    this.#keyListeners.add(fn);
    return () => {
      this.#keyListeners.delete(fn);
    };
  };

  /** `key`'s view; the previous object while unchanged. */
  itemView(key: Key): ItemView<SlotId> {
    const previous = this.#views.get(key);
    const id = this.#mirror.slotOf(key);
    // A removed key renders on with its last view until it unmounts.
    if (id === undefined && previous) return previous;
    const live = id === undefined ? undefined : this.#slots.get(id)?.view;
    const view = live ?? previous?.view;
    if (previous && previous.id === id && previous.view === view) {
      return previous;
    }
    const next = { id: id as SlotId, data: view?.data, view };
    this.#views.set(key, next);
    return next;
  }

  /** `key`'s view subscription and host callback. */
  itemCallbacks(key: Key) {
    let callbacks = this.#itemCallbacks.get(key);
    if (!callbacks) {
      callbacks = {
        subscribe: (fn) => {
          let set = this.#itemListeners.get(key);
          if (!set) {
            set = new Set();
            this.#itemListeners.set(key, set);
          }
          set.add(fn);
          return () => {
            set.delete(fn);
            if (set.size === 0) this.#itemListeners.delete(key);
          };
        },
        onHost: (host) => this.setItemHost(key, host),
      };
      this.#itemCallbacks.set(key, callbacks);
    }
    return callbacks;
  }

  // --- Arrangement

  /** Applies a batch: places hosts, updates the item list, fires moves
   *  and the settle. */
  applyBatch(batch: readonly ArrangementOp<Key, SlotId>[]) {
    const priorAttach = new Map<Key, SlotId | typeof BACKSTAGE | undefined>();
    for (const op of batch) {
      if (!priorAttach.has(op.key)) {
        priorAttach.set(op.key, this.#attached.get(op.key));
      }
    }
    const change = this.#mirror.applyBatch(batch);
    this.#placeMoved(change);
    // Hosts outliving a resubscribe rejoin.
    for (const key of change.added) this.#place(key);
    for (const key of change.removed) this.#nestOffstage.delete(key);
    this.#retryNested();
    this.#dispatchEnters();

    const moves = change.moved.flatMap(({ key, from, to }) => {
      if (!this.#hosts.has(key)) return [];
      const prior = priorAttach.get(key);
      const fromRef = {
        id: from,
        host:
          prior === undefined || prior === BACKSTAGE
            ? null
            : this.#hostOf(prior),
      };
      const toRef = {
        id: to,
        host: this.#attached.get(key) === to ? this.#hostOf(to) : null,
      };
      return [{ key, fromRef, toRef }];
    });
    for (const { key } of change.moved) this.#notifyItem(key);
    for (const key of change.added) this.#notifyItem(key);

    const membership = change.added.length > 0 || change.removed.length > 0;
    if (membership) {
      // Survivors keep their list position; React moves no fibers.
      const removed = new Set(change.removed);
      this.#keys = [
        ...this.#keys.filter((key) => !removed.has(key)),
        ...change.added,
      ];
      for (const fn of [...this.#keyListeners]) fn();
    }
    const endNow = !membership && this.#pendingSettles.length === 0;
    if (!endNow) this.#pendingSettles.push(change.slots);

    for (const { key, fromRef, toRef } of moves) {
      dispatch(this.#listeners, (listener) =>
        listener.onMove?.(key, fromRef, toRef),
      );
    }
    if (endNow && change.slots.size > 0) this.#settle(change.slots);
  }

  /** The item list committed: fires the settles it waited on. */
  committed() {
    const ends = this.#pendingSettles;
    this.#pendingSettles = [];
    for (const slots of ends) {
      if (slots.size > 0) this.#settle(slots);
    }
  }

  /** Applies the diff from the mirror to the arrangement `replay` builds. */
  resync(replay: readonly ArrangementOp<Key, SlotId>[]) {
    const target = new ArrangementMirror<Key, SlotId>();
    target.applyBatch(replay);
    const scratch = new ArrangementMirror<Key, SlotId>();
    scratch.applyBatch(replayOps(this.#mirror.snapshot()));
    this.applyBatch(reconcileArrangement(scratch, target.snapshot()));
  }

  // --- Hosts

  setItemHost(key: Key, host: Host | null) {
    const previous = this.#hosts.get(key);
    if (previous === host) return;
    if (previous !== undefined) {
      this.#adapter.detach(previous);
      this.#hosts.delete(key);
      this.#attached.delete(key);
      this.#nestOffstage.delete(key);
    }
    if (host === null) {
      if (!this.#mirror.has(key)) {
        this.#views.delete(key);
        this.#itemCallbacks.delete(key);
      }
      return;
    }
    this.#hosts.set(key, host);
    this.#place(key);
    this.#dispatchEnters();
  }

  setBackstage = (host: Host | null) => {
    this.#backstage = host;
    if (host === null) {
      // Offstage hosts leave with the backstage host; the next one takes them.
      for (const [key, at] of this.#attached) {
        if (at === BACKSTAGE) this.#attached.delete(key);
      }
      return;
    }
    for (const key of this.#hosts.keys()) {
      if (!this.#attached.has(key)) this.#place(key);
    }
    this.#dispatchEnters();
  };

  /** Claims `id` for the slot instance `token`, else warns and returns
   *  undefined. */
  #claim(id: SlotId, token: object, owner: Key | undefined) {
    let entry = this.#slots.get(id);
    if (!entry) {
      entry = { token, host: null, owner, view: undefined };
      this.#slots.set(id, entry);
    }
    if (entry.token === token) return entry;
    this.#warnOnce(`slot:${String(id)}`, `two <Slot>s share id ${String(id)}`);
    return undefined;
  }

  registerSlot(id: SlotId, token: object, owner: Key | undefined) {
    const entry = this.#claim(id, token, owner);
    if (!entry) return () => undefined;
    entry.owner = owner;
    this.#placeSlot(id);
    this.#retryNested();
    this.#dispatchEnters();
    return () => {
      if (this.#slots.get(id)?.token !== token) return;
      this.#slots.delete(id);
      this.#sendSlotOffstage(id);
      this.#notifySlot(id);
    };
  }

  updateSlot(
    id: SlotId,
    token: object,
    owner: Key | undefined,
    values: readonly unknown[],
    render: ComponentType<ItemProps<never>> | undefined,
    data: unknown,
  ) {
    const entry = this.#claim(id, token, owner);
    if (!entry) return;
    const view = entry.view;
    if (
      view &&
      view.render === render &&
      Object.is(view.data, data) &&
      sameValues(view.values, values)
    ) {
      return;
    }
    entry.view = { values, render, data };
    this.#notifySlot(id);
  }

  setSlotHost(
    id: SlotId,
    token: object,
    owner: Key | undefined,
    host: Host | null,
  ) {
    if (host === null) {
      // An unregistered slot already sent its items offstage.
      const entry = this.#slots.get(id);
      if (entry?.token !== token || entry.host === null) return;
      entry.host = null;
      this.#sendSlotOffstage(id);
      return;
    }
    const entry = this.#claim(id, token, owner);
    if (!entry || entry.host === host) return;
    entry.host = host;
    this.#placeSlot(id);
    this.#retryNested();
    this.#dispatchEnters();
  }

  // --- Dev context check

  #stageContexts: ReadonlyMap<AnyContext, unknown> | null = null;

  setStageContexts = (map: ReadonlyMap<AnyContext, unknown>) => {
    this.#stageContexts = map;
  };

  /** Warns once per unknown context whose slot value differs from the
   *  stage's. */
  checkSlotContexts(
    id: SlotId,
    map: ReadonlyMap<AnyContext, unknown>,
    known: ReadonlySet<AnyContext>,
  ) {
    const stage = this.#stageContexts;
    if (!stage) return;
    for (const [context, value] of map) {
      if (known.has(context)) continue;
      if (stage.has(context) && Object.is(stage.get(context), value)) continue;
      this.#warnOnce(
        context,
        `slot ${String(id)} sees ${context.displayName ?? "a context"} ` +
          `with a value the stage lacks; add it to bridge or unbridged`,
      );
    }
  }

  // --- Internals

  #hostOf(slot: SlotId) {
    return this.#slots.get(slot)?.host ?? null;
  }

  #warnOnce(id: unknown, message: string) {
    if (this.#warned.has(id)) return;
    this.#warned.add(id);
    warn(message);
  }

  #notifyItem(key: Key) {
    const listeners = this.#itemListeners.get(key);
    if (listeners) for (const fn of [...listeners]) fn();
  }

  #notifySlot(id: SlotId) {
    for (const key of this.#mirror.order(id)) this.#notifyItem(key);
  }

  #settle(slots: ReadonlySet<SlotId>) {
    dispatch(this.#listeners, (listener) => listener.onSettle?.(slots));
  }

  /** Whether `slot` lies inside `key`'s own content. */
  #nestsIn(key: Key, slot: SlotId) {
    const seen = new Set<Key>();
    for (let s: SlotId | undefined = slot; s !== undefined;) {
      const owner = this.#slots.get(s)?.owner;
      if (owner === undefined) return false;
      if (owner === key || seen.has(owner)) return true;
      seen.add(owner);
      s = this.#mirror.slotOf(owner);
    }
    return false;
  }

  /** The host of the first key after `key` attached under `slot`. */
  #nextHost(key: Key, slot: SlotId): Host | null {
    const order = this.#mirror.order(slot);
    for (let i = order.indexOf(key) + 1; i < order.length; i++) {
      if (this.#attached.get(order[i]) === slot) {
        return this.#hosts.get(order[i]) ?? null;
      }
    }
    return null;
  }

  /** Attaches `key`'s host under its slot, else sends it offstage.
   *  `quiet` skips the enter event; moves report their own. */
  #place(key: Key, quiet = false) {
    const host = this.#hosts.get(key);
    if (host === undefined) return;
    const slot = this.#mirror.slotOf(key);
    const parent = slot === undefined ? null : this.#hostOf(slot);
    if (slot === undefined || parent === null) {
      this.#sendOffstage(key, host);
      return;
    }
    if (this.#nestsIn(key, slot)) {
      if (!this.#nestOffstage.has(key)) {
        this.#nestOffstage.add(key);
        warn(
          `${String(key)} sits in slot ${String(slot)} inside itself; offstage`,
        );
      }
      this.#sendOffstage(key, host);
      return;
    }
    this.#nestOffstage.delete(key);
    this.#adapter.attach(host, parent, this.#nextHost(key, slot));
    const entered = this.#attached.get(key) !== slot;
    this.#attached.set(key, slot);
    if (entered && !quiet) this.#enters.push([key, { id: slot, host: parent }]);
  }

  /** Fires gathered enters once every host is placed. */
  #dispatchEnters() {
    const enters = this.#enters;
    this.#enters = [];
    for (const [key, ref] of enters) {
      dispatch(this.#listeners, (listener) => listener.onEnter?.(key, ref));
    }
  }

  /** Re-places keys offstage for nesting; a move may have untangled them. */
  #retryNested() {
    for (const key of [...this.#nestOffstage]) this.#place(key);
  }

  #sendOffstage(key: Key, host: Host) {
    if (this.#attached.get(key) === BACKSTAGE) return;
    if (this.#backstage === null) {
      this.#attached.delete(key);
      return;
    }
    this.#adapter.attach(host, this.#backstage, null);
    this.#attached.set(key, BACKSTAGE);
  }

  /** Places `slot`'s keys, last first, so each `before` is in place. */
  #placeSlot(slot: SlotId) {
    const order = this.#mirror.order(slot);
    for (let i = order.length - 1; i >= 0; i--) this.#place(order[i]);
  }

  #sendSlotOffstage(slot: SlotId) {
    for (const key of this.#mirror.order(slot)) {
      const host = this.#hosts.get(key);
      if (host !== undefined && this.#attached.get(key) === slot) {
        this.#sendOffstage(key, host);
      }
    }
  }

  /** Places moved keys per destination slot, last first. */
  #placeMoved(change: ArrangementChange<Key, SlotId>) {
    const moved = new Map<SlotId, Set<Key>>();
    for (const { key, to } of change.moved) {
      let keys = moved.get(to);
      if (!keys) {
        keys = new Set();
        moved.set(to, keys);
      }
      keys.add(key);
    }
    for (const [slot, keys] of moved) {
      const order = this.#mirror.order(slot);
      for (let i = order.length - 1; i >= 0; i--) {
        if (keys.has(order[i])) this.#place(order[i], true);
      }
    }
  }
}
