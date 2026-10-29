import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  next(prefix: string): string;
}

/** Deterministic ids (sub_001, sub_002, ...) so tests can assert exact values. */
export class SequentialIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}_${String(value).padStart(3, '0')}`;
  }
}

export class RandomIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
}
