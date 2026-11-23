import { dispatch } from "./dispatch.ts";

/** One arrangement change; `before` names the next sibling, null the end. */
export type ArrangementOp<Key, SlotId> =
  | { type: "add"; key: Key; slot: SlotId; before: Key | null }
  | { type: "move"; key: Key; slot: SlotId; before: Key | null }
  | { type: "remove"; key: Key };

/** Ordered keys per slot. */
export type ArrangementSnapshot<Key, SlotId> = ReadonlyMap<
  SlotId,
  readonly Key[]
>;

/** Source of op batches; each batch leaves every key in at most one slot. */
export interface Arrangement<Key, SlotId> {
  /** Calls `fn` synchronously with the current arrangement as one `add`
   *  batch, then with each later batch. Returns an unsubscribe. */
  subscribe(
    fn: (batch: readonly ArrangementOp<Key, SlotId>[]) => void,
  ): () => void;
  /** Current arrangement; undefined while ops await delivery. Dev builds
   *  check the stage's mirror against it. */
  snapshot?(): ArrangementSnapshot<Key, SlotId> | undefined;
}

/** Net effect of one batch on a key that changed slot or position. */
export interface ArrangementMove<Key, SlotId> {
  key: Key;
  from: SlotId;
  to: SlotId;
}

/** Net effect of one batch. */
export interface ArrangementChange<Key, SlotId> {
  added: Key[];
  removed: Key[];
  /** Keys in a new slot, or reordered among keys that stayed. */
  moved: ArrangementMove<Key, SlotId>[];
  /** Slots whose order differs from before the batch. */
  slots: Set<SlotId>;
}

/** An op naming a missing key, a duplicate key, or a `before` outside
 *  the target slot. */
export class ArrangementError extends Error {
  override name = "ArrangementError";
}

/** Key → slot and per-slot order, updated by ops. */
export class ArrangementMirror<Key, SlotId> {
  readonly #slotOf = new Map<Key, SlotId>();
  readonly #orders = new Map<SlotId, Key[]>();
  static readonly #empty: readonly never[] = [];

  /** The slot holding `key`. */
  slotOf(key: Key): SlotId | undefined {
    return this.#slotOf.get(key);
  }

  has(key: Key): boolean {
    return this.#slotOf.has(key);
  }

  /** Live view of `slot`'s keys, in order. */
  order(slot: SlotId): readonly Key[] {
    return this.#orders.get(slot) ?? ArrangementMirror.#empty;
  }

  keys(): IterableIterator<Key> {
    return this.#slotOf.keys();
  }

  /** Slots holding a key. */
  slots(): IterableIterator<SlotId> {
    return this.#orders.keys();
  }

  /** Copy of every non-empty slot's order. */
  snapshot(): Map<SlotId, Key[]> {
    return new Map([...this.#orders].map(([slot, keys]) => [slot, [...keys]]));
  }

  clear() {
    this.#slotOf.clear();
    this.#orders.clear();
  }

  /** Applies `op`; throws {@link ArrangementError} and leaves the mirror
   *  unchanged on an invalid op. */
  apply(op: ArrangementOp<Key, SlotId>) {
    switch (op.type) {
      case "add":
        if (this.#slotOf.has(op.key)) {
          throw new ArrangementError(`add: ${String(op.key)} is present`);
        }
        this.#checkBefore(op.key, op.slot, op.before);
        this.#insert(op.key, op.slot, op.before);
        return;
      case "move":
        if (!this.#slotOf.has(op.key)) {
          throw new ArrangementError(`move: ${String(op.key)} is missing`);
        }
        this.#checkBefore(op.key, op.slot, op.before);
        this.#remove(op.key);
        this.#insert(op.key, op.slot, op.before);
        return;
      case "remove":
        if (!this.#slotOf.has(op.key)) {
          throw new ArrangementError(`remove: ${String(op.key)} is missing`);
        }
        this.#remove(op.key);
        return;
      default:
        op satisfies never;
    }
  }

  /** Applies `batch` and reports its net change; an invalid op throws
   *  and rolls the batch back. */
  applyBatch(
    batch: readonly ArrangementOp<Key, SlotId>[],
  ): ArrangementChange<Key, SlotId> {
    const startSlot = new Map<Key, SlotId | undefined>();
    const startOrder = new Map<SlotId, Key[]>();
    const touchSlot = (slot: SlotId | undefined) => {
      if (slot !== undefined && !startOrder.has(slot)) {
        startOrder.set(slot, [...this.order(slot)]);
      }
    };
    const undo: ArrangementOp<Key, SlotId>[] = [];
    try {
      for (const op of batch) {
        const current = this.#slotOf.get(op.key);
        if (!startSlot.has(op.key)) startSlot.set(op.key, current);
        touchSlot(current);
        if (op.type !== "remove") touchSlot(op.slot);
        const inverse = this.#inverse(op);
        this.apply(op);
        undo.push(inverse);
      }
    } catch (error) {
      for (const op of undo.reverse()) this.apply(op);
      throw error;
    }

    const slotAtStart = (key: Key) =>
      startSlot.has(key) ? startSlot.get(key) : this.#slotOf.get(key);
    // Keys in `slot` before and after the batch.
    const stayed = (keys: readonly Key[], slot: SlotId) =>
      keys.filter(
        (key) => slotAtStart(key) === slot && this.#slotOf.get(key) === slot,
      );
    const stayedRanks = new Map<SlotId, [Map<Key, number>, Map<Key, number>]>();
    const ranks = (slot: SlotId) => {
      let entry = stayedRanks.get(slot);
      if (!entry) {
        const rank = (keys: Key[]) => new Map(keys.map((k, i) => [k, i]));
        entry = [
          rank(stayed(startOrder.get(slot) ?? [], slot)),
          rank(stayed(this.order(slot), slot)),
        ];
        stayedRanks.set(slot, entry);
      }
      return entry;
    };

    const change: ArrangementChange<Key, SlotId> = {
      added: [],
      removed: [],
      moved: [],
      slots: new Set(),
    };
    for (const [key, from] of startSlot) {
      const to = this.#slotOf.get(key);
      if (from === undefined) {
        if (to !== undefined) change.added.push(key);
      } else if (to === undefined) {
        change.removed.push(key);
      } else if (from !== to) {
        change.moved.push({ key, from, to });
      } else {
        const [before, after] = ranks(to);
        if (before.get(key) !== after.get(key)) {
          change.moved.push({ key, from, to });
        }
      }
    }
    for (const [slot, before] of startOrder) {
      const after = this.order(slot);
      if (
        before.length !== after.length ||
        before.some((key, index) => after[index] !== key)
      ) {
        change.slots.add(slot);
      }
    }
    return change;
  }

  /** The op restoring `op.key`'s current place after `op`. */
  #inverse(op: ArrangementOp<Key, SlotId>): ArrangementOp<Key, SlotId> {
    const slot = this.#slotOf.get(op.key);
    if (slot === undefined) return { type: "remove", key: op.key };
    const order = this.order(slot);
    const before = order[order.indexOf(op.key) + 1] ?? null;
    return {
      type: op.type === "move" ? "move" : "add",
      key: op.key,
      slot,
      before,
    };
  }

  #checkBefore(key: Key, slot: SlotId, before: Key | null) {
    if (before === null) return;
    if (before === key || this.#slotOf.get(before) !== slot) {
      throw new ArrangementError(
        `${String(key)}: before ${String(before)} is outside its slot`,
      );
    }
  }

  #insert(key: Key, slot: SlotId, before: Key | null) {
    let order = this.#orders.get(slot);
    if (!order) {
      order = [];
      this.#orders.set(slot, order);
    }
    if (before === null) order.push(key);
    else order.splice(order.indexOf(before), 0, key);
    this.#slotOf.set(key, slot);
  }

  #remove(key: Key) {
    const slot = this.#slotOf.get(key)!;
    const order = this.#orders.get(slot)!;
    order.splice(order.indexOf(key), 1);
    if (order.length === 0) this.#orders.delete(slot);
    this.#slotOf.delete(key);
  }
}

/** `add` ops rebuilding `snapshot` from empty. */
export function replayOps<Key, SlotId>(
  snapshot: ArrangementSnapshot<Key, SlotId>,
): ArrangementOp<Key, SlotId>[] {
  return [...snapshot].flatMap(([slot, keys]) =>
    keys.map((key) => ({ type: "add" as const, key, slot, before: null })),
  );
}

/** Differences between two arrangements, as readable lines. */
export function diffSnapshots<Key, SlotId>(
  expected: ArrangementSnapshot<Key, SlotId>,
  actual: ArrangementSnapshot<Key, SlotId>,
): string[] {
  const lines: string[] = [];
  for (const slot of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(slot) ?? [];
    const have = actual.get(slot) ?? [];
    if (
      want.length !== have.length ||
      want.some((key, index) => have[index] !== key)
    ) {
      lines.push(
        `${String(slot)}: expected [${want.join(", ")}], got [${have.join(", ")}]`,
      );
    }
  }
  return lines;
}

/** Indexes into `values` of one longest increasing run. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length);
  values.forEach((value, index) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    previous[index] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = index;
  });
  const run = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]) run.add(i);
  return run;
}

/** Applies and returns ops turning `mirror` into `next`; keys already in
 *  order stay put. */
export function reconcileArrangement<Key, SlotId>(
  mirror: ArrangementMirror<Key, SlotId>,
  next: ArrangementSnapshot<Key, SlotId>,
): ArrangementOp<Key, SlotId>[] {
  const full = new Map(next);
  for (const slot of mirror.slots()) if (!full.has(slot)) full.set(slot, []);
  return reconcileSlots(mirror, full);
}

/** {@link reconcileArrangement} over the slots `next` names. Other slots
 *  only lose keys `next` claims; keys leaving the named slots for none
 *  are removed. */
export function reconcileSlots<Key, SlotId>(
  mirror: ArrangementMirror<Key, SlotId>,
  next: ArrangementSnapshot<Key, SlotId>,
): ArrangementOp<Key, SlotId>[] {
  const nextSlot = new Map<Key, SlotId>();
  for (const [slot, keys] of next) {
    for (const key of keys) {
      if (nextSlot.has(key)) {
        throw new ArrangementError(`snapshot: ${String(key)} appears twice`);
      }
      nextSlot.set(key, slot);
    }
  }

  const ops: ArrangementOp<Key, SlotId>[] = [];
  const emit = (op: ArrangementOp<Key, SlotId>) => {
    mirror.apply(op);
    ops.push(op);
  };
  for (const slot of next.keys()) {
    for (const key of [...mirror.order(slot)]) {
      if (!nextSlot.has(key)) emit({ type: "remove", key });
    }
  }
  for (const [slot, keys] of next) {
    const current = mirror.order(slot);
    const rank = new Map(current.map((key, index) => [key, index]));
    const resident = keys.flatMap((key, index) =>
      rank.has(key) ? [index] : [],
    );
    const run = longestIncreasing(resident.map((i) => rank.get(keys[i])!));
    const stable = new Set([...run].map((i) => keys[resident[i]]));
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      if (stable.has(key)) continue;
      const before = keys[i + 1] ?? null;
      emit({ type: mirror.has(key) ? "move" : "add", key, slot, before });
    }
  }
  return ops;
}

/** Imperative arrangement: each op outside {@link
 *  MutableArrangement.batch} emits a batch of its own. */
export interface MutableArrangement<Key, SlotId> extends Arrangement<
  Key,
  SlotId
> {
  add(key: Key, slot: SlotId, before?: Key | null): void;
  move(key: Key, slot: SlotId, before?: Key | null): void;
  remove(key: Key): void;
  /** Runs `fn`, emitting its ops as one batch; nests. */
  batch(fn: () => void): void;
  slotOf(key: Key): SlotId | undefined;
  order(slot: SlotId): readonly Key[];
  snapshot(): ArrangementSnapshot<Key, SlotId>;
}

/** Listener set replaying `snapshot` to each new subscriber. Batches
 *  emitted from a listener queue: every listener sees batches in emit
 *  order. */
function createEmitter<Key, SlotId>(
  snapshot: () => ArrangementSnapshot<Key, SlotId>,
  onFirst?: () => void,
  onLast?: () => void,
) {
  type Batch = readonly ArrangementOp<Key, SlotId>[];
  interface Entry {
    fn: (batch: Batch) => void;
    /** Index of the first batch past its replay. */
    since: number;
  }
  const listeners = new Set<Entry>();
  const queue: { batch: Batch; index: number }[] = [];
  let emitted = 0;
  let draining = false;
  return {
    emit: (batch: Batch) => {
      if (batch.length === 0) return;
      queue.push({ batch, index: emitted++ });
      if (draining) return;
      draining = true;
      try {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { batch, index } = next;
          dispatch(listeners, (entry) => {
            if (index >= entry.since) entry.fn(batch);
          });
        }
      } finally {
        draining = false;
      }
    },
    subscribe: (fn: (batch: Batch) => void) => {
      if (listeners.size === 0) onFirst?.();
      const entry: Entry = { fn, since: emitted };
      listeners.add(entry);
      const replay = replayOps(snapshot());
      if (replay.length > 0) fn(replay);
      return () => {
        listeners.delete(entry);
        if (listeners.size === 0) onLast?.();
      };
    },
  };
}

/** A {@link MutableArrangement}; invalid ops throw {@link ArrangementError}. */
export function createArrangement<Key, SlotId>(): MutableArrangement<
  Key,
  SlotId
> {
  const mirror = new ArrangementMirror<Key, SlotId>();
  const emitter = createEmitter(() => mirror.snapshot());
  let pending: ArrangementOp<Key, SlotId>[] | null = null;

  const run = (op: ArrangementOp<Key, SlotId>) => {
    mirror.apply(op);
    if (pending) pending.push(op);
    else emitter.emit([op]);
  };

  return {
    subscribe: emitter.subscribe,
    snapshot: () => mirror.snapshot(),
    slotOf: (key) => mirror.slotOf(key),
    order: (slot) => mirror.order(slot),
    add: (key, slot, before = null) => run({ type: "add", key, slot, before }),
    move: (key, slot, before = null) =>
      run({ type: "move", key, slot, before }),
    remove: (key) => run({ type: "remove", key }),
    batch(fn) {
      if (pending) {
        fn();
        return;
      }
      const ops: ArrangementOp<Key, SlotId>[] = [];
      pending = ops;
      try {
        fn();
      } finally {
        pending = null;
        emitter.emit(ops);
      }
    },
  };
}

/**
 * Arrangement over an opaque store: each `subscribe` notification diffs
 * `getSnapshot()` against the last snapshot into one batch. Arguments
 * follow `useSyncExternalStore`.
 *
 * @param subscribe Registers `notify` for store changes; returns an
 *   unsubscribe.
 * @param getSnapshot Current slot orders; a key appears at most once.
 */
export function fromSnapshot<Key, SlotId>(
  subscribe: (notify: () => void) => () => void,
  getSnapshot: () => ArrangementSnapshot<Key, SlotId>,
): Arrangement<Key, SlotId> {
  const mirror = new ArrangementMirror<Key, SlotId>();
  let unsubscribe: (() => void) | null = null;
  const emitter = createEmitter(
    () => mirror.snapshot(),
    () => {
      reconcileArrangement(mirror, getSnapshot());
      unsubscribe = subscribe(() =>
        emitter.emit(reconcileArrangement(mirror, getSnapshot())),
      );
    },
    () => {
      unsubscribe?.();
      unsubscribe = null;
      mirror.clear();
    },
  );
  return { subscribe: emitter.subscribe, snapshot: getSnapshot };
}
