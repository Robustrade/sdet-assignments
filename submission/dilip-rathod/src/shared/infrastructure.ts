import { randomBytes } from 'node:crypto';

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export type IdPrefix = 'sub' | 'inv' | 'pa' | 'ntf';

export interface IdGenerator {
  next(prefix: IdPrefix): string;
}

export class RandomIdGenerator implements IdGenerator {
  next(prefix: IdPrefix): string {
    return `${prefix}_${randomBytes(8).toString('hex')}`;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** All timestamps are persisted as ISO-8601 UTC strings, which sort lexicographically. */
export function iso(date: Date): string {
  return date.toISOString();
}
