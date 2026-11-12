export const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp `days` after `from`. */
export function daysAfter(from: Date | string, days: number): string {
  const base = typeof from === 'string' ? new Date(from) : from;
  return new Date(base.getTime() + days * DAY_MS).toISOString();
}
