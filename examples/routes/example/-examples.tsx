export type ExampleMeta = {
  label: string;
  to: string;
  description: string;
};

export const EXAMPLES: readonly ExampleMeta[] = [
  {
    label: "React Three Fiber",
    to: "/example/r3f",
    description: "A mesh moves between scene slots and keeps its state",
  },
  {
    label: "DOM lists",
    to: "/example/dom",
    description: "Tasks move between lists and keep their notes and focus",
  },
];
