/**
 * Seam around identifier generation.
 *
 * Deterministic ids (sub_001, inv_001, ...) keep assertions and failure output
 * readable, and let tests reference records without threading ids everywhere.
 */
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

export class RandomIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
