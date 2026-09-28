import type { Clock } from '../../src/ports/Clock';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Test double for time. Time only moves when a test says so. */
export class FakeClock implements Clock {
  private current: Date;
  constructor(start = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * DAY_MS);
  }
  daysFromStart(start: Date, days: number): string {
    return new Date(start.getTime() + days * DAY_MS).toISOString();
  }
}
