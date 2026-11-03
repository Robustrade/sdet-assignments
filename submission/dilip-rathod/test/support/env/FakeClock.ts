import type { Clock } from '../../../src/shared/infrastructure';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Time only moves when a test moves it. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  iso(): string {
    return this.current.toISOString();
  }

  advanceDays(days: number): this {
    this.current = new Date(this.current.getTime() + days * DAY_MS);
    return this;
  }

  advanceMinutes(minutes: number): this {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
    return this;
  }

  /** Jumps to an instant; refuses to go backwards so tests cannot fake out-of-order time by accident. */
  setTo(instant: string): this {
    const target = new Date(instant);
    if (target < this.current) throw new Error(`FakeClock cannot move backwards (${this.iso()} -> ${instant})`);
    this.current = target;
    return this;
  }
}
