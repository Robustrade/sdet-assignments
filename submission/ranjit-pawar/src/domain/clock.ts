/**
 * Seam around "now".
 *
 * Billing is time-driven (trial end, period end, retry schedule). Reading the
 * wall clock directly would make the lifecycle untestable without sleeping, so
 * time is injected.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test implementation: time only moves when a test moves it. */
export class MutableClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = new Date(at);
  }

  advanceDays(days: number): void {
    this.current = addDays(this.current, days);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function iso(at: Date): string {
  return at.toISOString();
}
