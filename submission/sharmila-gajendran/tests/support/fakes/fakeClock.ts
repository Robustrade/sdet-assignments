import type { Clock } from '../../../src/domain/clock';
import { DAY_MS } from '../time';

/** A clock that only moves when the test moves it. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-05T09:00:00.000Z')) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * DAY_MS);
  }
}
