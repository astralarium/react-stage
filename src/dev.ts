declare const process: { env: { NODE_ENV?: string } } | undefined;

/** Development build; bundlers fold `process.env.NODE_ENV`. */
export const DEV =
  (typeof process === "undefined" ? undefined : process.env.NODE_ENV) !==
  "production";

/** Development-only warning. */
export function warn(message: string) {
  if (DEV) console.warn(`[@astralarium/react-stage] ${message}`);
}
