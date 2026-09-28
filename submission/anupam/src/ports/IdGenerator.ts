/** Deterministic ids (sub_001, inv_001...) make failures easy to read. */
export interface IdGenerator {
  next(prefix: string): string;
}
export class SequentialIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${String(n).padStart(3, '0')}`;
  }
}
