/**
 * Deterministic test double for Clock with millisecond/day progression helpers.
 * Author: Vedant Dalkari
 */

import type { Clock } from '../../../src/ports/Clock.js';

export const DEFAULT_T0_ISO = '2026-01-01T00:00:00.000Z';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export class ControlledClock implements Clock {
  private currentMs: number;

  public constructor(initialIso: string = DEFAULT_T0_ISO) {
    const parsed = Date.parse(initialIso);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid initial ISO timestamp: ${initialIso}`);
    }
    this.currentMs = parsed;
  }

  public now(): Date {
    return new Date(this.currentMs);
  }

  public nowIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  public setIso(iso: string): string {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid ISO timestamp: ${iso}`);
    }
    this.currentMs = parsed;
    return this.nowIso();
  }

  public advanceMs(ms: number): string {
    this.currentMs += ms;
    return this.nowIso();
  }

  public advanceHours(hours: number): string {
    return this.advanceMs(hours * MS_PER_HOUR);
  }

  public advanceDays(days: number): string {
    return this.advanceMs(days * MS_PER_DAY);
  }

  public plusOneMs(): string {
    return this.advanceMs(1);
  }

  public plusOneDay(): string {
    return this.advanceDays(1);
  }

  public plusFourteenDays(): string {
    return this.advanceDays(14);
  }

  public plusThirtyDays(): string {
    return this.advanceDays(30);
  }
}
