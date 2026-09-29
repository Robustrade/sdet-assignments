import type { Clock } from '../../../src/clock';

const DAY_MS = 24 * 60 * 60 * 1000;

export class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceDays(days: number): this {
    this.current = new Date(this.current.getTime() + days * DAY_MS);
    return this;
  }
}
