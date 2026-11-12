import { AuditRepository, type NewAuditEntry } from '../../../src/persistence/repositories/auditRepository';

/**
 * Audit repository that can be told to fail on a chosen write. Used to prove that a failure
 * halfway through a change rolls everything back (partial-failure tests).
 */
export class FaultInjectingAuditRepository extends AuditRepository {
  private writes = 0;
  private failAt: number | null = null;

  /** Makes the n-th audit write from now fail (1 = the very next write). */
  failOnNthWrite(n: number): void {
    this.failAt = this.writes + n;
  }

  override record(entry: NewAuditEntry): void {
    this.writes += 1;
    if (this.failAt !== null && this.writes === this.failAt) {
      this.failAt = null;
      throw new Error('Injected failure: audit write');
    }
    super.record(entry);
  }
}
