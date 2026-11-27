/**
 * Deterministic clock port interface.
 * Author: Vedant Dalkari
 */

export interface Clock {
  now(): Date;
  nowIso(): string;
}
