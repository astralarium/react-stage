import {
  createArrangement,
  type ItemProps,
  type MutableArrangement,
  Slot,
  Stage,
  useItemSlot,
} from "@astralarium/react-stage";
import { domAdapter } from "@astralarium/react-stage/dom";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpIcon } from "lucide-react";
import { createContext, use, useState } from "react";

import { Button } from "#components/ui/button";

import { Frame } from "./-frame";

export const Route = createFileRoute("/example/dom")({
  component: DomExample,
});

type List = "todo" | "done";

const OTHER: Record<List, List> = { todo: "done", done: "todo" };

const LISTS: readonly { id: List; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "done", label: "Done" },
];

const TaskArrangement = createContext<MutableArrangement<string, List> | null>(
  null,
);

/** A task with an uncontrolled note and its move buttons. */
function Task({ itemKey }: ItemProps<string>) {
  const arrangement = use(TaskArrangement);
  const list = useItemSlot<List>(itemKey).id;
  if (!arrangement) return null;
  const raise = () => {
    const order = arrangement.order(list);
    const index = order.indexOf(itemKey);
    if (index > 0) arrangement.move(itemKey, list, order[index - 1]);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-sm font-medium">{itemKey}</span>
      <input
        aria-label={`${itemKey} note`}
        name={`${itemKey}-note`}
        placeholder="Note"
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px]"
      />
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={`Raise ${itemKey}`}
        onClick={raise}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-18"
        onClick={() => arrangement.move(itemKey, OTHER[list])}
      >
        {list === "todo" ? "Done" : "Reopen"}
      </Button>
    </div>
  );
}

/** Two lists sharing one stage. */
function DomExample() {
  const [arrangement] = useState(() => {
    const arrangement = createArrangement<string, List>();
    arrangement.batch(() => {
      for (const task of ["Sketch", "Build", "Ship"]) {
        arrangement.add(task, "todo");
      }
    });
    return arrangement;
  });

  return (
    <Frame
      title="DOM lists"
      subtitle="Type a note, then move the task; the note and focus stay"
      sourceUrl="https://github.com/astralarium/react-stage/blob/main/examples/routes/example/dom.tsx"
    >
      <TaskArrangement value={arrangement}>
        <Stage adapter={domAdapter} arrangement={arrangement} render={Task}>
          <div className="grid w-full max-w-3xl gap-4 self-center p-4 sm:grid-cols-2">
            {LISTS.map((list) => (
              <section
                key={list.id}
                aria-label={list.label}
                className="flex flex-col gap-2 rounded-lg border p-4"
              >
                <h2 className="mb-2 font-semibold">{list.label}</h2>
                <Slot id={list.id} />
              </section>
            ))}
          </div>
        </Stage>
      </TaskArrangement>
    </Frame>
  );
}
