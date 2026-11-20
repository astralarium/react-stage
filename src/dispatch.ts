/** Calls `call` on each of `listeners`, as of the call; a throw reaches
 *  the host's uncaught-error reporting after the rest run. */
export function dispatch<Listener>(
  listeners: Iterable<Listener>,
  call: (listener: Listener) => void,
) {
  for (const listener of [...listeners]) {
    try {
      call(listener);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}
