import { addDays, Clock } from '../../../src/domain/time';

export const TEST_EPOCH = '2026-01-01T09:00:00.000Z';

/** Time only moves when a test moves it. */
export class FakeClock implements Clock {
  private current: string;

  constructor(start: string = TEST_EPOCH) {
    this.current = new Date(start).toISOString();
  }

  now(): string {
    return this.current;
  }

  advanceDays(days: number): string {
    this.current = addDays(this.current, days);
    return this.current;
  }

  set(iso: string): void {
    this.current = new Date(iso).toISOString();
  }
}
