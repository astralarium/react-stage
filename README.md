# `@astralarium/react-stage`

Render items once and move them between slots while preserving state.

```tsx
import { createArrangement, Slot, Stage } from "@astralarium/react-stage";
import { r3fAdapter } from "@astralarium/react-stage/r3f";

const arrangement = createArrangement<string, "left" | "right">();
arrangement.add("orb", "left");

<Stage adapter={r3fAdapter} arrangement={arrangement} render={Orb}>
  <group position={[-2, 0, 0]}>
    <Slot id="left" />
  </group>
  <group position={[2, 0, 0]}>
    <Slot id="right" />
  </group>
</Stage>;

arrangement.move("orb", "right");
```

Adapters: `./r3f` for react-three-fiber, `./dom` for react-dom.

## Arrangement

Arrangements store item slots and order.
Changes stream as batches of `add`, `move` and `remove` ops.
`useItemSlot(key)` returns the item's slot and data.

Items are managed by the arrangement.
Unmounting a slot hides its items "offstage".
Event handlers can check `useOffstage()`,
eg. to stop raycasting in React Three Fiber.

## Bridge

Items render under the stage,
using context from the stage root.
Pass contexts to `bridge` to read from each item's slot instead.

```tsx
<Stage bridge={[Theme]} ...>
```

`contextProbe` from `./its-fine` warns in dev about contexts `bridge` misses.

## Plugins

Plugins can wrap items, the item list, or both.
The `useStageEvents` hook enables animating moves and tracking hosts.

```tsx
const outline: StagePlugin<string> = {
  Item: ({ children }) => <Outline>{children}</Outline>,
};

<Stage plugins={[outline]} ...>
```
