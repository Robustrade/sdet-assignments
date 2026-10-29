import { Clock } from '../../../src/support/Clock';

/** Deterministic clock so trial dates and timestamps are exact, and tests never sleep. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 24 * 60 * 60 * 1000);
  }

  /** Millisecond precision (may be negative to step back from a boundary), for exact "just before / exactly at" cases. */
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
