/**
 * Generates readable, deterministic IDs per service instance (`sub_0001`, ...).
 * Each test builds a fresh instance, so IDs never leak between tests.
 */
export class IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}_${String(value).padStart(4, '0')}`;
  }
}
