export interface IdGenerator {
  next(prefix: string): string;
}

/** Readable, deterministic ids (sub_0001, inv_0001, ...). Used by the fixture so test output is easy to follow. */
export class SequentialIds implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${String(n).padStart(4, '0')}`;
  }
}
