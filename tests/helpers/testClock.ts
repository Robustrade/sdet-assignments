const DAY_MS = 24 * 60 * 60 * 1000;

/** Fake time. advanceDays(14) ends a trial instantly, no waiting. */
export class TestClock {
  private current = new Date('2026-01-01T00:00:00.000Z');
  now() { return new Date(this.current); }
  advanceDays(days: number) { this.current = new Date(this.current.getTime() + days * DAY_MS); }
  advanceMs(ms: number) { this.current = new Date(this.current.getTime() + ms); }
}
