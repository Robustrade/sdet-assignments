/** Source of "now". Injected so tests can control time (trial ends, billing periods). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}
