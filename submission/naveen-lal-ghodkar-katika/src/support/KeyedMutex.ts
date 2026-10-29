/**
 * Runs async work one at a time per key (FIFO). The in-memory repositories are async, so two requests
 * for the same subscription could otherwise interleave between "read" and "write" and one would
 * overwrite the other (e.g. a webhook re-activating a subscription that was canceled in between).
 * Work for different keys runs concurrently. Single-process only; a real database would use a row
 * lock or optimistic versioning instead.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => finished);
    this.tails.set(key, tail);

    await previous; // never rejects: `finished` only ever resolves
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key); // nobody queued behind us: do not leak keys
      }
    }
  }

  /** Number of keys that currently have running or queued work (for leak checks in tests). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
