export type IdPrefix = 'sub' | 'inv' | 'pay';

/** Readable, deterministic IDs per service instance (sub_000001, inv_000001, ...). */
export class SequentialIds {
  private readonly counters = new Map<IdPrefix, number>();

  next(prefix: IdPrefix): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${String(n).padStart(6, '0')}`;
  }
}
