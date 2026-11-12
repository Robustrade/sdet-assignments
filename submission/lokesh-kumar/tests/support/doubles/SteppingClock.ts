/** Deterministic clock: every reading is one second after the previous one. */
export class SteppingClock {
  private current: number;
  private readonly stepMs: number;

  constructor(startIso = '2026-01-01T00:00:00.000Z', stepMs = 1000) {
    this.current = Date.parse(startIso);
    this.stepMs = stepMs;
  }

  readonly now = (): Date => {
    const value = new Date(this.current);
    this.current += this.stepMs;
    return value;
  };
}
