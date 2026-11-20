import { describe, expect, test, vi } from "vitest";

import {
  ArrangementError,
  ArrangementMirror,
  type ArrangementOp,
  type ArrangementSnapshot,
  createArrangement,
  fromSnapshot,
  reconcileArrangement,
  reconcileSlots,
} from "./arrangement.ts";

type Op = ArrangementOp<string, string>;

function mirrorOf(snapshot: Record<string, string[]>) {
  const mirror = new ArrangementMirror<string, string>();
  for (const [slot, keys] of Object.entries(snapshot)) {
    for (const key of keys) {
      mirror.apply({ type: "add", key, slot, before: null });
    }
  }
  return mirror;
}

const snap = (
  snapshot: Record<string, string[]>,
): ArrangementSnapshot<string, string> => new Map(Object.entries(snapshot));

describe("ArrangementMirror", () => {
  test("an op naming a missing key throws and leaves the mirror unchanged", () => {
    const mirror = mirrorOf({ a: ["x"] });
    expect(() =>
      mirror.apply({ type: "move", key: "y", slot: "a", before: null }),
    ).toThrow(ArrangementError);
    expect(() =>
      mirror.apply({ type: "add", key: "x", slot: "b", before: null }),
    ).toThrow(ArrangementError);
    expect(() =>
      mirror.apply({ type: "move", key: "x", slot: "b", before: "x" }),
    ).toThrow(ArrangementError);
    expect(mirror.snapshot()).toEqual(snap({ a: ["x"] }));
  });

  test("a batch with an invalid op leaves the mirror as before", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: ["z"] });
    expect(() =>
      mirror.applyBatch([
        { type: "remove", key: "x" },
        { type: "move", key: "z", slot: "a", before: "y" },
        { type: "add", key: "w", slot: "b", before: null },
        { type: "move", key: "q", slot: "a", before: null },
      ]),
    ).toThrow(ArrangementError);
    expect(mirror.snapshot()).toEqual(snap({ a: ["x", "y"], b: ["z"] }));
  });

  test("a batch reports its net adds, removes and moves", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: ["z"] });
    const change = mirror.applyBatch([
      { type: "add", key: "w", slot: "b", before: "z" },
      { type: "move", key: "x", slot: "b", before: null },
      { type: "remove", key: "y" },
    ]);
    expect(change.added).toEqual(["w"]);
    expect(change.removed).toEqual(["y"]);
    expect(change.moved).toEqual([{ key: "x", from: "a", to: "b" }]);
    expect(change.slots).toEqual(new Set(["a", "b"]));
  });

  test("a move away and back is a net no-op", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: [] });
    const change = mirror.applyBatch([
      { type: "move", key: "x", slot: "b", before: null },
      { type: "move", key: "x", slot: "a", before: "y" },
    ]);
    expect(change).toEqual({
      added: [],
      removed: [],
      moved: [],
      slots: new Set(),
    });
  });

  test("a reorder within a slot moves the reordered key only", () => {
    const mirror = mirrorOf({ a: ["x", "y", "z"] });
    const change = mirror.applyBatch([
      { type: "move", key: "z", slot: "a", before: "x" },
    ]);
    expect(change.moved).toEqual([{ key: "z", from: "a", to: "a" }]);
    expect(change.slots).toEqual(new Set(["a"]));
  });

  test("a key shifted by a neighbor's removal stays unmoved", () => {
    const mirror = mirrorOf({ a: ["x", "y"] });
    const change = mirror.applyBatch([
      { type: "remove", key: "x" },
      { type: "move", key: "y", slot: "a", before: null },
    ]);
    expect(change.moved).toEqual([]);
  });
});

describe("reconcileArrangement", () => {
  test("an unchanged snapshot emits no ops", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: ["z"] });
    expect(
      reconcileArrangement(mirror, snap({ a: ["x", "y"], b: ["z"] })),
    ).toEqual([]);
  });

  test("moving one key to the front emits one move", () => {
    const mirror = mirrorOf({ a: ["w", "x", "y", "z"] });
    const ops = reconcileArrangement(mirror, snap({ a: ["z", "w", "x", "y"] }));
    expect(ops).toEqual<Op[]>([
      { type: "move", key: "z", slot: "a", before: "w" },
    ]);
  });

  test("random snapshots reconcile to the target", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const slots = ["a", "b", "c"];
    const randomSnapshot = () => {
      const keys = Array.from({ length: 12 }, (_, i) => `k${i}`).filter(
        () => random() < 0.7,
      );
      const result = new Map<string, string[]>();
      for (const key of keys.sort(() => random() - 0.5)) {
        const slot = slots[Math.floor(random() * slots.length)];
        result.set(slot, [...(result.get(slot) ?? []), key]);
      }
      return result;
    };
    const mirror = new ArrangementMirror<string, string>();
    for (let round = 0; round < 200; round++) {
      const target = randomSnapshot();
      const replay = new ArrangementMirror<string, string>();
      for (const [slot, keys] of mirror.snapshot()) {
        for (const key of keys)
          replay.apply({ type: "add", key, slot, before: null });
      }
      const ops = reconcileArrangement(mirror, target);
      expect(mirror.snapshot()).toEqual(target);
      replay.applyBatch(ops);
      expect(replay.snapshot()).toEqual(target);
    }
  });
});

describe("reconcileSlots", () => {
  test("unnamed slots keep their keys", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: ["z"] });
    const ops = reconcileSlots(mirror, snap({ a: ["y", "x"] }));
    expect(ops).toEqual<Op[]>([
      { type: "move", key: "y", slot: "a", before: "x" },
    ]);
    expect(mirror.snapshot()).toEqual(snap({ a: ["y", "x"], b: ["z"] }));
  });

  test("a key claimed from an unnamed slot moves", () => {
    const mirror = mirrorOf({ a: ["x"], b: ["z"] });
    expect(reconcileSlots(mirror, snap({ a: ["x", "z"] }))).toEqual<Op[]>([
      { type: "move", key: "z", slot: "a", before: null },
    ]);
  });

  test("a key leaving the named slots for none of them is removed", () => {
    const mirror = mirrorOf({ a: ["x", "y"], b: ["z"] });
    expect(reconcileSlots(mirror, snap({ a: ["x"] }))).toEqual<Op[]>([
      { type: "remove", key: "y" },
    ]);
  });
});

describe("createArrangement", () => {
  test("a subscriber receives the current arrangement, then each batch", () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "a");
    const batches: Op[][] = [];
    arrangement.subscribe((batch) => batches.push([...batch]));
    arrangement.batch(() => {
      arrangement.add("y", "a", "x");
      arrangement.move("x", "b");
    });
    arrangement.remove("y");
    expect(batches).toEqual<Op[][]>([
      [{ type: "add", key: "x", slot: "a", before: null }],
      [
        { type: "add", key: "y", slot: "a", before: "x" },
        { type: "move", key: "x", slot: "b", before: null },
      ],
      [{ type: "remove", key: "y" }],
    ]);
  });

  test("a batch emitted from a listener reaches every subscriber after the current one", () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "a");
    const first: Op[][] = [];
    const second: Op[][] = [];
    arrangement.subscribe((batch) => {
      first.push([...batch]);
      if (arrangement.slotOf("x") === "b") arrangement.move("x", "c");
    });
    arrangement.subscribe((batch) => second.push([...batch]));
    arrangement.move("x", "b");
    const expected: Op[][] = [
      [{ type: "move", key: "x", slot: "b", before: null }],
      [{ type: "move", key: "x", slot: "c", before: null }],
    ];
    expect(first.slice(1)).toEqual(expected);
    expect(second.slice(1)).toEqual(expected);
  });

  test("a subscriber joining from a listener skips batches its replay holds", () => {
    const arrangement = createArrangement<string, string>();
    const late: Op[][] = [];
    arrangement.subscribe(() => {
      if (late.length === 0) {
        arrangement.add("y", "a");
        arrangement.subscribe((batch) => late.push([...batch]));
      }
    });
    arrangement.add("x", "a");
    expect(late).toEqual<Op[][]>([
      [
        { type: "add", key: "x", slot: "a", before: null },
        { type: "add", key: "y", slot: "a", before: null },
      ],
    ]);
  });

  test("an invalid op throws before emitting", () => {
    const arrangement = createArrangement<string, string>();
    const listener = vi.fn();
    arrangement.subscribe(listener);
    expect(() => arrangement.move("x", "a")).toThrow(ArrangementError);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("fromSnapshot", () => {
  test("each store change emits the diff as one batch", () => {
    let state = snap({ a: ["x", "y"] });
    let notify = () => undefined as void;
    const unsubscribe = vi.fn();
    const arrangement = fromSnapshot(
      (fn) => {
        notify = fn;
        return unsubscribe;
      },
      () => state,
    );
    const batches: Op[][] = [];
    const stop = arrangement.subscribe((batch) => batches.push([...batch]));
    state = snap({ a: ["y"], b: ["x"] });
    notify();
    notify();
    stop();
    expect(batches).toEqual<Op[][]>([
      [
        { type: "add", key: "x", slot: "a", before: null },
        { type: "add", key: "y", slot: "a", before: null },
      ],
      [{ type: "move", key: "x", slot: "b", before: null }],
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
