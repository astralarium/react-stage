/** Orb colors; an orb keyed by a color starts on it. */
export const ORB_COLORS = ["orange", "hotpink", "skyblue"] as const;

export type OrbColor = (typeof ORB_COLORS)[number];
