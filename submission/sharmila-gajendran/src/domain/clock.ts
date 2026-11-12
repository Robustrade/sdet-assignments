/** Injected so tests can end a trial or reach a renewal date without waiting. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
