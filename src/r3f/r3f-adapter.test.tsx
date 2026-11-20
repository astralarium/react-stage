/**
 * Stage on r3f: content hosts attach under slot groups and follow the
 * renderer's hide and unmount.
 */
import { createRoot } from "@react-three/fiber/legacy";
import { act, Activity, type ReactNode } from "react";
import { type Object3D, Raycaster, Vector3 } from "three";
import { afterEach, describe, expect, test } from "vitest";

import { createArrangement, type MutableArrangement } from "../arrangement.ts";
import { Slot, Stage } from "../stage.tsx";
import type { ItemProps } from "../stage-store.ts";
import { r3fAdapter } from "./r3f-adapter.ts";

/** WebGL stand-in: r3f drives no frames under `frameloop: "never"`. */
function stubRenderer(canvas: HTMLCanvasElement) {
  const noop = () => undefined;
  return {
    render: noop,
    setSize: noop,
    setPixelRatio: noop,
    getPixelRatio: () => 1,
    dispose: noop,
    domElement: canvas,
    xr: {
      enabled: false,
      addEventListener: noop,
      removeEventListener: noop,
      setAnimationLoop: noop,
    },
    shadowMap: {},
    setAnimationLoop: noop,
    info: { render: {} },
    capabilities: {},
  };
}

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

async function mount(node: () => ReactNode) {
  const canvas = document.createElement("canvas");
  const root = createRoot(canvas);
  await root.configure({
    gl: stubRenderer(canvas) as never,
    frameloop: "never",
    events: undefined,
    size: { width: 10, height: 10, top: 0, left: 0 },
  });
  let scene!: Object3D;
  const rerender = () => {
    act(() => {
      scene = root.render(node()).getState().scene;
    });
  };
  rerender();
  unmount = () => act(() => root.unmount());
  return { scene: () => scene, rerender };
}

function Card({ itemKey }: ItemProps<string>) {
  return (
    <mesh name={itemKey}>
      <boxGeometry />
    </mesh>
  );
}

function Scene({
  arrangement,
  hidden = false,
  showB = true,
}: {
  arrangement: MutableArrangement<string, string>;
  hidden?: boolean;
  showB?: boolean;
}) {
  return (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <Stage adapter={r3fAdapter} arrangement={arrangement} render={Card}>
        <group name="a">
          <Slot id="a" />
        </group>
        {showB && (
          <group name="b">
            <Slot id="b" />
          </group>
        )}
      </Stage>
    </Activity>
  );
}

/** The slot host under the named group. */
function slotHost(scene: Object3D, name: string) {
  return scene.getObjectByName(name)!.children[0];
}

/** The item's content host. */
function contentHost(scene: Object3D, key: string) {
  return scene.getObjectByName(key)!.parent!;
}

describe("r3fAdapter", () => {
  test("hosts land under slot groups in arrangement order", async () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "a");
    arrangement.add("y", "a");
    const { scene } = await mount(() => <Scene arrangement={arrangement} />);
    const slotA = slotHost(scene(), "a");
    expect(slotA.children).toEqual([
      contentHost(scene(), "x"),
      contentHost(scene(), "y"),
    ]);

    const host = contentHost(scene(), "y");
    act(() => {
      arrangement.move("y", "b");
    });
    expect(host.parent).toBe(slotHost(scene(), "b"));
    act(() => {
      arrangement.move("y", "a", "x");
    });
    expect(slotA.children).toEqual([host, contentHost(scene(), "x")]);
  });

  test("an unmount detaches the content host", async () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "a");
    const { scene } = await mount(() => <Scene arrangement={arrangement} />);
    const host = contentHost(scene(), "x");
    act(() => {
      arrangement.remove("x");
    });
    expect(host.parent).toBeNull();
    expect(scene().getObjectByName("x")).toBeUndefined();
  });

  test("a hidden item leaves its slot and returns when revealed", async () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "a");
    let hidden = false;
    const { scene, rerender } = await mount(() => (
      <Scene arrangement={arrangement} hidden={hidden} />
    ));
    const host = contentHost(scene(), "x");
    hidden = true;
    rerender();
    expect(host.parent).toBeNull();
    hidden = false;
    rerender();
    expect(host.parent).toBe(slotHost(scene(), "a"));
  });

  test("a slot unmount sends its items backstage, hidden from scene raycasts", async () => {
    const arrangement = createArrangement<string, string>();
    arrangement.add("x", "b");
    let showB = true;
    const { scene, rerender } = await mount(() => (
      <Scene arrangement={arrangement} showB={showB} />
    ));
    const host = contentHost(scene(), "x");
    const ray = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    expect(ray.intersectObject(scene(), true)).not.toEqual([]);
    showB = false;
    rerender();
    expect(host.parent?.visible).toBe(false);
    expect(ray.intersectObject(scene(), true)).toEqual([]);
    showB = true;
    rerender();
    expect(host.parent).toBe(slotHost(scene(), "b"));
  });
});
