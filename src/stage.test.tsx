/**
 * Stage on react-dom: items render once, keyed, and their hosts move
 * between slots without remounting.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { FiberProvider } from "its-fine";
import {
  Activity,
  createContext,
  type ReactNode,
  StrictMode,
  use,
  useLayoutEffect,
  useState,
} from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  type Arrangement,
  createArrangement,
  fromSnapshot,
  type MutableArrangement,
} from "./arrangement.ts";
import { domAdapter } from "./dom/index.ts";
import { ContextProbe } from "./its-fine/index.ts";
import { Slot, Stage } from "./stage.tsx";
import type { StagePlugin } from "./stage-context.ts";
import {
  useItemSlot,
  useOffstage,
  useStage,
  useStageEvents,
} from "./stage-hooks.ts";
import type { ItemProps, StageEvents, StageHandle } from "./stage-store.ts";

afterEach(cleanup);

const Theme = createContext("none");

const renders = new Map<string, number>();
const mounts = new Map<string, number>();

/** Shows its key, theme and a mount-time stamp; counts renders and
 *  mounts. */
function Card({ itemKey }: ItemProps<string>) {
  renders.set(itemKey, (renders.get(itemKey) ?? 0) + 1);
  const theme = use(Theme);
  const [stamp] = useState(() => {
    mounts.set(itemKey, (mounts.get(itemKey) ?? 0) + 1);
    return mounts.get(itemKey);
  });
  return (
    <span data-testid={itemKey} tabIndex={-1}>
      {itemKey}:{theme}:{stamp}
    </span>
  );
}

/** Renders a nested slot inside the item. */
function Holder({ itemKey }: ItemProps<string>) {
  return (
    <span data-testid={itemKey}>
      <Theme value="green">
        <Slot id={`inner-${itemKey}`} />
      </Theme>
    </span>
  );
}

/** A stage whose items each hold a slot, under one root slot. */
function Holders({
  arrangement,
}: {
  arrangement: MutableArrangement<string, string>;
}) {
  return (
    <Stage
      adapter={domAdapter}
      arrangement={arrangement}
      render={Card}
      bridge={[Theme]}
    >
      <Slot id="holders" render={Holder} />
    </Stage>
  );
}

interface PluginItemProps {
  itemKey: string;
  children?: ReactNode;
}

function OuterItem({ itemKey, children }: PluginItemProps) {
  return <b data-plugin={`outer-${itemKey}`}>{children}</b>;
}

function InnerItem({ children }: PluginItemProps) {
  return <i>{children}</i>;
}

function OuterList({ children }: { children?: ReactNode }) {
  return <div data-testid="root-outer">{children}</div>;
}

function Events({
  listener,
}: {
  listener: StageEvents<string, string, HTMLElement>;
}) {
  useStageEvents(listener);
  return null;
}

interface SceneProps {
  arrangement: MutableArrangement<string, string>;
  showB?: boolean;
  listener?: StageEvents<string, string, HTMLElement>;
  plugins?: StagePlugin<string>[];
  children?: ReactNode;
}

function Scene({
  arrangement,
  showB = true,
  listener = {},
  plugins,
  children,
}: SceneProps) {
  return (
    <Stage
      adapter={domAdapter}
      arrangement={arrangement}
      render={Card}
      bridge={[Theme]}
      plugins={plugins}
    >
      <Events listener={listener} />
      <section data-testid="a">
        <Theme value="red">
          <Slot id="a" />
        </Theme>
      </section>
      {showB && (
        <section data-testid="b">
          <Theme value="blue">
            <Slot id="b" />
          </Theme>
        </section>
      )}
      {children}
    </Stage>
  );
}

type OnMove = NonNullable<StageEvents<string, string, HTMLElement>["onMove"]>;

function keysIn(slot: string) {
  return [...screen.getByTestId(slot).querySelectorAll("span")].map(
    (span) => span.dataset.testid,
  );
}

function setup(seed: Record<string, string[]>) {
  renders.clear();
  mounts.clear();
  const arrangement = createArrangement<string, string>();
  for (const [slot, keys] of Object.entries(seed)) {
    for (const key of keys) arrangement.add(key, slot);
  }
  return arrangement;
}

describe("Stage", () => {
  test("items render under their slots in arrangement order", () => {
    const arrangement = setup({ a: ["x", "y"], b: ["z"] });
    render(<Scene arrangement={arrangement} />);
    expect(keysIn("a")).toEqual(["x", "y"]);
    expect(keysIn("b")).toEqual(["z"]);
    act(() => arrangement.add("w", "a", "y"));
    expect(keysIn("a")).toEqual(["x", "w", "y"]);
  });

  test("items keep state across moves", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    render(<Scene arrangement={arrangement} />);
    const node = screen.getByTestId("x");
    act(() => arrangement.move("x", "b"));
    expect(keysIn("b")).toEqual(["x"]);
    expect(screen.getByTestId("x")).toBe(node);
    expect(mounts.get("x")).toBe(1);
  });

  test("a moved item keeps focus", () => {
    const arrangement = setup({ a: ["x", "y"], b: [] });
    render(<Scene arrangement={arrangement} />);
    const node = screen.getByTestId("x");
    node.focus();
    act(() => arrangement.move("x", "b"));
    expect(document.activeElement).toBe(node);
    act(() => arrangement.move("x", "a", "y"));
    expect(document.activeElement).toBe(node);
  });

  test("a move renders the moved item once and unmoved items zero times", () => {
    const arrangement = setup({ a: ["x", "y"], b: ["z"] });
    render(<Scene arrangement={arrangement} />);
    renders.clear();
    act(() => arrangement.move("x", "b", "z"));
    expect(keysIn("b")).toEqual(["x", "z"]);
    expect(Object.fromEntries(renders)).toEqual({ x: 1 });
  });

  test("a fixed bridge keeps state across slots with different contexts", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    render(<Scene arrangement={arrangement} />);
    expect(screen.getByTestId("x").textContent).toBe("x:red:1");
    act(() => arrangement.move("x", "b"));
    expect(screen.getByTestId("x").textContent).toBe("x:blue:1");
  });

  test("a net no-op batch fires nothing", () => {
    const arrangement = setup({ a: ["x", "y"], b: [] });
    const onMove = vi.fn();
    const onSettle = vi.fn();
    render(<Scene arrangement={arrangement} listener={{ onMove, onSettle }} />);
    onSettle.mockClear();
    renders.clear();
    act(() =>
      arrangement.batch(() => {
        arrangement.move("x", "b");
        arrangement.move("x", "a", "y");
      }),
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(onSettle).not.toHaveBeenCalled();
    expect(renders.size).toBe(0);
  });

  test("a move fires once per moved item with both slot hosts, then a settle", () => {
    const arrangement = setup({ a: ["x", "y"], b: [] });
    const events: string[] = [];
    const listener: StageEvents<string, string, HTMLElement> = {
      onMove: (key, from, to) => {
        expect(from.host?.contains(screen.getByTestId(key))).toBe(false);
        expect(to.host?.contains(screen.getByTestId(key))).toBe(true);
        events.push(`move ${key} ${from.id}→${to.id}`);
      },
      onSettle: (slots) => events.push(`settle ${[...slots].join(",")}`),
    };
    render(<Scene arrangement={arrangement} listener={listener} />);
    events.length = 0;
    act(() => arrangement.move("y", "b"));
    expect(events).toEqual(["move y a→b", "settle a,b"]);
  });

  test("a fresh host, a late slot mount and a return from offstage fire an enter; a move fires none", () => {
    const arrangement = setup({ a: [], b: ["y"] });
    const events: string[] = [];
    const listener: StageEvents<string, string, HTMLElement> = {
      onEnter: (key, slot) => {
        expect(slot.host?.contains(screen.getByTestId(key))).toBe(true);
        events.push(`enter ${key} ${slot.id}`);
      },
    };
    const { rerender } = render(
      <Scene arrangement={arrangement} listener={listener} showB={false} />,
    );
    expect(events).toEqual([]);
    act(() => arrangement.add("x", "a"));
    rerender(<Scene arrangement={arrangement} listener={listener} />);
    expect(events).toEqual(["enter x a", "enter y b"]);
    events.length = 0;
    act(() => arrangement.move("x", "b"));
    rerender(
      <Scene arrangement={arrangement} listener={listener} showB={false} />,
    );
    rerender(<Scene arrangement={arrangement} listener={listener} />);
    expect(events).toEqual(["enter x b", "enter y b"]);
  });

  test("a slot mount fires its enters once every host sits in the slot", () => {
    const arrangement = setup({ b: ["x", "y"] });
    const inPlace: boolean[] = [];
    const listener: StageEvents<string, string, HTMLElement> = {
      onEnter: (_key, slot) => {
        inPlace.push(
          ["x", "y"].every((key) =>
            slot.host?.contains(screen.getByTestId(key)),
          ),
        );
      },
    };
    const { rerender } = render(
      <Scene arrangement={arrangement} listener={listener} showB={false} />,
    );
    rerender(<Scene arrangement={arrangement} listener={listener} />);
    expect(inPlace).toEqual([true, true]);
  });

  test("a membership batch's slots stay settling until it settles", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    const grabbed: { stage?: StageHandle<string, string, HTMLElement> } = {};
    function Grab() {
      const stage = useStage<string, string, HTMLElement>();
      useLayoutEffect(() => {
        grabbed.stage = stage;
      });
      return null;
    }
    const settling: boolean[] = [];
    const listener: StageEvents<string, string, HTMLElement> = {
      onMove: (_key, _from, to) =>
        settling.push(grabbed.stage!.settling(to.id)),
      onSettle: () => settling.push(grabbed.stage!.settling("b")),
    };
    render(
      <Scene arrangement={arrangement} listener={listener}>
        <Grab />
      </Scene>,
    );
    settling.length = 0;
    act(() =>
      arrangement.batch(() => {
        arrangement.move("x", "b");
        arrangement.add("y", "a");
      }),
    );
    expect(settling).toEqual([true, false]);
  });

  test("an added item's batch settles after it mounts", () => {
    const arrangement = setup({ a: [] });
    const onSettle = vi.fn(() => {
      expect(keysIn("a")).toEqual(["x"]);
    });
    render(<Scene arrangement={arrangement} listener={{ onSettle }} />);
    act(() => arrangement.add("x", "a"));
    expect(onSettle).toHaveBeenCalledWith(new Set(["a"]));
  });

  test("a slot unmount sends its items offstage", () => {
    const arrangement = setup({ a: [], b: ["x"] });
    const { container, rerender } = render(<Scene arrangement={arrangement} />);
    rerender(<Scene arrangement={arrangement} showB={false} />);
    const card = screen.getByTestId("x");
    expect(card.closest("[hidden]")).not.toBeNull();
    expect(container.contains(card)).toBe(true);
    expect(card.textContent).toBe("x:blue:1");
    rerender(<Scene arrangement={arrangement} />);
    expect(keysIn("b")).toEqual(["x"]);
    expect(mounts.get("x")).toBe(1);
  });

  test("an item moves into a slot inside another item", () => {
    const arrangement = setup({ a: ["h", "x"] });
    render(
      <Scene arrangement={arrangement}>
        <Slot id="holders" render={Holder} />
      </Scene>,
    );
    act(() => arrangement.move("h", "holders"));
    act(() => arrangement.move("x", "inner-h"));
    expect(screen.getByTestId("h").contains(screen.getByTestId("x"))).toBe(
      true,
    );
  });

  test("an item moved into a slot inside itself goes offstage and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrangement = setup({ holders: ["h"] });
    render(
      <Scene arrangement={arrangement}>
        <Slot id="holders" render={Holder} />
      </Scene>,
    );
    act(() => arrangement.move("h", "inner-h"));
    expect(screen.getByTestId("h").closest("[hidden]")).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("inside itself"));
    warn.mockRestore();
  });

  test("plugins wrap each item and the item list in order", () => {
    const arrangement = setup({ a: ["x"] });
    const outer: StagePlugin<string> = { Item: OuterItem, List: OuterList };
    const inner: StagePlugin<string> = { Item: InnerItem };
    render(<Scene arrangement={arrangement} plugins={[outer, inner]} />);
    const card = screen.getByTestId("x");
    expect(card.parentElement?.tagName).toBe("I");
    expect(card.parentElement?.parentElement?.dataset.plugin).toBe("outer-x");
    expect(screen.getByTestId("root-outer")).toBeTruthy();
  });

  test("useItemSlot reads the item's slot and slot data", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    function Labeled({ itemKey }: ItemProps<string>) {
      const label = useItemSlot<string, string, string | undefined>(
        itemKey,
        (slot) => slot.data,
      );
      return <span data-testid={itemKey}>{label}</span>;
    }
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Labeled}>
        <section data-testid="a">
          <Slot id="a" data="first" />
        </section>
        <section data-testid="b">
          <Slot id="b" data="second" />
        </section>
      </Stage>,
    );
    expect(screen.getByTestId("x").textContent).toBe("first");
    act(() => arrangement.move("x", "b"));
    expect(screen.getByTestId("x").textContent).toBe("second");
  });

  test("a stage under StrictMode renders each item once", () => {
    const arrangement = setup({ a: ["x", "y"] });
    render(
      <StrictMode>
        <Scene arrangement={arrangement} />
      </StrictMode>,
    );
    expect(keysIn("a")).toEqual(["x", "y"]);
    act(() => arrangement.move("y", "b"));
    expect(keysIn("b")).toEqual(["y"]);
  });

  test("the dev context check warns on a slot context outside bridge and unbridged, with no FiberProvider above", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const Stray = createContext("stage");
    Stray.displayName = "Stray";
    const Local = createContext("stage");
    const arrangement = setup({ a: ["x"] });
    render(
      <Stage
        adapter={domAdapter}
        arrangement={arrangement}
        render={Card}
        bridge={[Theme]}
        unbridged={[Local]}
        contextProbe={ContextProbe}
      >
        <Theme value="red">
          <Local value="slot">
            <Slot id="quiet" />
          </Local>
        </Theme>
        <Stray value="slot">
          <Slot id="a" />
        </Stray>
      </Stage>,
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Stray"));
    warn.mockRestore();
  });

  test("ContextProbe reports its context map only when it changes", () => {
    const onMap = vi.fn<(map: ReadonlyMap<unknown, unknown>) => void>();
    const { rerender } = render(
      <Theme value="red">
        <ContextProbe onMap={onMap} />
      </Theme>,
    );
    rerender(
      <Theme value="red">
        <ContextProbe onMap={onMap} />
      </Theme>,
    );
    expect(onMap).toHaveBeenCalledOnce();
    rerender(
      <Theme value="blue">
        <ContextProbe onMap={onMap} />
      </Theme>,
    );
    expect(onMap).toHaveBeenCalledTimes(2);
    expect(onMap.mock.calls[1][0].get(Theme)).toBe("blue");
  });

  test("an arrangement whose snapshot disagrees with its ops warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrangement: Arrangement<string, string> = {
      subscribe: (fn) => {
        fn([{ type: "add", key: "x", slot: "a", before: null }]);
        return () => undefined;
      },
      snapshot: () => new Map([["a", ["y"]]]),
    };
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Card} />,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("drifted"));
    warn.mockRestore();
  });

  test("an item arranged into a nested slot from the start reads that slot", () => {
    const arrangement = setup({ holders: ["h"], "inner-h": ["x"] });
    render(<Holders arrangement={arrangement} />);
    const card = screen.getByTestId("x");
    expect(screen.getByTestId("h").contains(card)).toBe(true);
    expect(card.textContent).toBe("x:green:1");
  });

  test("an item in a slot inside itself from the start goes offstage and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrangement = setup({ "inner-h": ["h"] });
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Holder}>
        <Slot id="root" />
      </Stage>,
    );
    expect(screen.getByTestId("h").closest("[hidden]")).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("inside itself"));
    warn.mockRestore();
  });

  test("an item offstage for nesting returns once the nesting untangles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrangement = setup({ holders: ["h1"], "inner-h1": ["h2"] });
    function Nested({ itemKey }: ItemProps<string>) {
      return <Holder itemKey={itemKey} />;
    }
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Nested}>
        <section data-testid="holders">
          <Slot id="holders" />
        </section>
      </Stage>,
    );
    act(() => arrangement.move("h1", "inner-h2"));
    expect(screen.getByTestId("h1").closest("[hidden]")).not.toBeNull();
    act(() => arrangement.move("h2", "holders"));
    expect(screen.getByTestId("h2").contains(screen.getByTestId("h1"))).toBe(
      true,
    );
    warn.mockRestore();
  });

  test("an offstage item keeps its slot's render and state", () => {
    const arrangement = setup({ b: ["x"] });
    function Slots({ showB }: { showB: boolean }) {
      return (
        <Stage adapter={domAdapter} arrangement={arrangement} render={Holder}>
          {showB && <Slot id="b" render={Card} />}
        </Stage>
      );
    }
    const { rerender } = render(<Slots showB />);
    rerender(<Slots showB={false} />);
    rerender(<Slots showB />);
    expect(screen.getByTestId("x").textContent).toBe("x:none:1");
    expect(mounts.get("x")).toBe(1);
  });

  test("an item whose slot unmounts sits offstage, as do items nested in it", () => {
    const arrangement = setup({ holders: ["h"], "inner-h": ["x"] });
    const grabbed: {
      stage?: StageHandle<string, string, HTMLElement>;
      offstageX?: () => boolean;
    } = {};
    function Grab() {
      const stage = useStage<string, string, HTMLElement>();
      useLayoutEffect(() => {
        grabbed.stage = stage;
      });
      return null;
    }
    function Probe({ itemKey }: ItemProps<string>) {
      const offstage = useOffstage();
      useLayoutEffect(() => {
        grabbed.offstageX = offstage;
      });
      return <Card itemKey={itemKey} />;
    }
    function Slots({ show }: { show: boolean }) {
      return (
        <Stage adapter={domAdapter} arrangement={arrangement} render={Probe}>
          <Grab />
          {show && <Slot id="holders" render={Holder} />}
        </Stage>
      );
    }
    const { rerender } = render(<Slots show />);
    expect([grabbed.stage!.offstage("h"), grabbed.offstageX!()]).toEqual([
      false,
      false,
    ]);
    rerender(<Slots show={false} />);
    expect([grabbed.stage!.offstage("h"), grabbed.offstageX!()]).toEqual([
      true,
      true,
    ]);
    rerender(<Slots show />);
    expect([grabbed.stage!.offstage("h"), grabbed.offstageX!()]).toEqual([
      false,
      false,
    ]);
  });

  test("an item moving into an unmounted slot keeps its render and state", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    function Slots({ showB }: { showB: boolean }) {
      return (
        <Stage adapter={domAdapter} arrangement={arrangement} render={Holder}>
          <Slot id="a" render={Card} />
          {showB && <Slot id="b" render={Card} />}
        </Stage>
      );
    }
    const { rerender } = render(<Slots showB={false} />);
    act(() => arrangement.move("x", "b"));
    rerender(<Slots showB />);
    expect(screen.getByTestId("x").textContent).toBe("x:none:1");
    expect(mounts.get("x")).toBe(1);
  });

  test("a throwing listener leaves the item list, other listeners and settles intact", () => {
    const errors: unknown[] = [];
    const microtask = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((fn) => {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      });
    const arrangement = setup({ a: ["x"], b: [] });
    const events: string[] = [];
    render(
      <Scene
        arrangement={arrangement}
        listener={{
          onMove: () => {
            throw new Error("boom");
          },
          onSettle: () => {
            throw new Error("settle");
          },
        }}
      >
        <Events
          listener={{
            onMove: (key) => events.push(`move ${key}`),
            onSettle: (slots) => events.push(`settle ${[...slots].join(",")}`),
          }}
        />
      </Scene>,
    );
    events.length = 0;
    errors.length = 0;
    act(() => {
      arrangement.batch(() => {
        arrangement.add("y", "a");
        arrangement.move("x", "b");
      });
    });
    expect(keysIn("a")).toEqual(["y"]);
    expect(keysIn("b")).toEqual(["x"]);
    expect(events).toEqual(["move x", "settle a,b"]);
    expect(errors.map((error) => (error as Error).message)).toEqual([
      "boom",
      "settle",
    ]);
    microtask.mockRestore();
  });

  test("a slot render of a different type remounts the item", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    function Other({ itemKey }: ItemProps<string>) {
      return <Card itemKey={itemKey} />;
    }
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Card}>
        <Slot id="a" />
        <Slot id="b" render={Other} />
      </Stage>,
    );
    act(() => arrangement.move("x", "b"));
    expect(mounts.get("x")).toBe(2);
  });

  test("a batch emitted from a listener applies after the current one", () => {
    const arrangement = setup({ a: ["x", "y"], b: [] });
    const events: string[] = [];
    const listener: StageEvents<string, string, HTMLElement> = {
      onMove: (key, from, to) => {
        events.push(`move ${key} ${from.id}→${to.id}`);
        if (key === "x") arrangement.move("y", "b");
      },
      onSettle: (slots) => events.push(`settle ${[...slots].join(",")}`),
    };
    render(<Scene arrangement={arrangement} listener={listener} />);
    events.length = 0;
    act(() => arrangement.move("x", "b"));
    expect(events).toEqual([
      "move x a→b",
      "settle a,b",
      "move y a→b",
      "settle a,b",
    ]);
    expect(keysIn("b")).toEqual(["x", "y"]);
  });

  test("a reorder within a slot fires a move into the same slot", () => {
    const arrangement = setup({ a: ["x", "y"] });
    const onMove = vi.fn<OnMove>();
    render(<Scene arrangement={arrangement} listener={{ onMove }} />);
    act(() => arrangement.move("y", "a", "x"));
    expect(keysIn("a")).toEqual(["y", "x"]);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][1].id).toBe("a");
    expect(onMove.mock.calls[0][2].id).toBe("a");
  });

  test("a move out of an offstage slot reports no source host", () => {
    const arrangement = setup({ a: [], b: ["x"] });
    const onMove = vi.fn<OnMove>();
    const { rerender } = render(
      <Scene arrangement={arrangement} listener={{ onMove }} />,
    );
    rerender(
      <Scene arrangement={arrangement} listener={{ onMove }} showB={false} />,
    );
    act(() => arrangement.move("x", "a"));
    expect(onMove.mock.calls[0][1]).toEqual({ id: "b", host: null });
    expect(keysIn("a")).toEqual(["x"]);
  });

  test("a move batch's settle waits behind a pending membership batch", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    const ends: string[] = [];
    render(
      <Scene
        arrangement={arrangement}
        listener={{ onSettle: (slots) => ends.push([...slots].join(",")) }}
      />,
    );
    ends.length = 0;
    act(() => {
      arrangement.add("y", "a");
      arrangement.move("x", "b");
    });
    expect(ends).toEqual(["a", "a,b"]);
  });

  test("a new arrangement moves only what differs", () => {
    const first = setup({ a: ["x", "y"] });
    const second = createArrangement<string, string>();
    second.add("x", "b");
    second.add("z", "a");
    const { rerender } = render(<Scene arrangement={first} />);
    rerender(<Scene arrangement={second} />);
    expect(keysIn("a")).toEqual(["z"]);
    expect(keysIn("b")).toEqual(["x"]);
    expect(mounts.get("x")).toBe(1);
  });

  test("a hidden stage applies moves on reveal and keeps item state", () => {
    const arrangement = setup({ a: ["x"], b: [] });
    function Hideable({ hidden }: { hidden: boolean }) {
      return (
        <Activity mode={hidden ? "hidden" : "visible"}>
          <Scene arrangement={arrangement} />
        </Activity>
      );
    }
    const { rerender } = render(<Hideable hidden={false} />);
    rerender(<Hideable hidden />);
    act(() => arrangement.move("x", "b"));
    rerender(<Hideable hidden={false} />);
    expect(keysIn("b")).toEqual(["x"]);
    expect(mounts.get("x")).toBe(1);
  });

  test("a fromSnapshot arrangement drives the stage", () => {
    renders.clear();
    mounts.clear();
    let state = new Map([["a", ["x", "y"]]]);
    const listeners = new Set<() => void>();
    const arrangement = fromSnapshot(
      (notify) => {
        listeners.add(notify);
        return () => listeners.delete(notify);
      },
      () => state,
    );
    render(
      <Stage adapter={domAdapter} arrangement={arrangement} render={Card}>
        <section data-testid="a">
          <Slot id="a" />
        </section>
        <section data-testid="b">
          <Slot id="b" />
        </section>
      </Stage>,
    );
    state = new Map([
      ["a", ["y"]],
      ["b", ["x"]],
    ]);
    act(() => listeners.forEach((notify) => notify()));
    expect(keysIn("a")).toEqual(["y"]);
    expect(keysIn("b")).toEqual(["x"]);
    expect(mounts.get("x")).toBe(1);
  });

  test("the dev context check skips the stage's own contexts in nested slots", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrangement = setup({ holders: ["h"] });
    render(
      <FiberProvider>
        <Stage
          adapter={domAdapter}
          arrangement={arrangement}
          bridge={[Theme]}
          contextProbe={ContextProbe}
        >
          <Slot id="holders" render={Holder} />
        </Stage>
      </FiberProvider>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
