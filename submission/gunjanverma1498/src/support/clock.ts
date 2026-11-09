/**
 * Clock seam.
 *
 * Time is injected so timestamps and trial-end calculations are deterministic in
 * tests. Production uses {@link SystemClock}; tests use {@link FixedClock}.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock pinned to a fixed instant, advanceable by tests. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
