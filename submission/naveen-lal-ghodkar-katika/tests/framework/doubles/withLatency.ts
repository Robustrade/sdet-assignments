/**
 * Wraps a repository so every method call yields to the event loop (`setImmediate`) before it runs.
 *
 * In-memory repositories answer within the same microtask burst, so two requests rarely interleave
 * between a "read" and the following "write". A real database does take time between the two. This
 * double restores that gap, so concurrency specs exercise the interleavings that locking exists for.
 * The wrapped repository still holds the data, so assertions can read the original directly.
 */
export function withLatency<T extends object>(repository: T): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      return async (...args: unknown[]) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return value.apply(target, args);
      };
    },
  });
}
