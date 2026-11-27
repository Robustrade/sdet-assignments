import { AuditEntry } from '../../../src/domain/types';
import { AuditInput, AuditLogRepository } from '../../../src/persistence/repositories';
import { SqlDatabase } from '../../../src/persistence/SqlDatabase';

/**
 * Audit repository that can be told to fail on a specific write. The audit append is usually the
 * last write in a unit of work, so failing it is a good way to simulate "crashed halfway through".
 */
export class FailingAuditLog extends AuditLogRepository {
  private failOn: { action: string; remaining: number } | null = null;
  failuresInjected = 0;

  constructor(db: SqlDatabase) {
    super(db);
  }

  failNext(action: string, times = 1): void {
    this.failOn = { action, remaining: times };
  }

  override append(input: AuditInput): AuditEntry {
    if (this.failOn && this.failOn.action === input.action && this.failOn.remaining > 0) {
      this.failOn.remaining--;
      this.failuresInjected++;
      throw new Error(`Injected failure writing audit '${input.action}'`);
    }
    return super.append(input);
  }
}
