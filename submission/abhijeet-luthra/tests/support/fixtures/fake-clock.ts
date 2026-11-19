import { Clock, DAY_MS } from '../../../src/clock';

/** Controllable time: tests move it forward to end trials and billing periods. */
export class FakeClock implements Clock {
  private current: number;

  constructor(startIso: string) {
    this.current = new Date(startIso).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceDays(days: number): void {
    this.current += days * DAY_MS;
  }

  advanceMinutes(minutes: number): void {
    this.current += minutes * 60 * 1000;
  }
}
