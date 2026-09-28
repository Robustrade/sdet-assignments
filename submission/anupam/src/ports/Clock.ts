/** Injected time source so tests can move time (trial end, renewals) deterministically. */
export interface Clock {
  now(): Date;
}
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
