/** Keyed items rendered once and re-parented under slots anywhere in the tree. */
export {
  type Arrangement,
  type ArrangementChange,
  ArrangementError,
  ArrangementMirror,
  type ArrangementMove,
  type ArrangementOp,
  type ArrangementSnapshot,
  createArrangement,
  diffSnapshots,
  fromSnapshot,
  type MutableArrangement,
  reconcileArrangement,
  reconcileSlots,
} from "./arrangement.ts";
export type { AnyContext, HostAdapter } from "./host-adapter.ts";
export { Slot, type SlotProps, Stage } from "./stage.tsx";
export type { ContextProbe, StagePlugin, StageProps } from "./stage-context.ts";
export {
  useItemSlot,
  useOffstage,
  useStage,
  useStageEvents,
} from "./stage-hooks.ts";
export type {
  ItemProps,
  ItemSlot,
  SlotRef,
  StageEvents,
  StageHandle,
} from "./stage-store.ts";
