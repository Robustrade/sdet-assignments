import type { AuditEntry } from '../domain/AuditEntry';

/** Append-only: there is deliberately no update or delete. */
export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
  /** Entries of one subscription in the order they were appended. */
  listBySubscription(subscriptionId: string): Promise<AuditEntry[]>;
  list(): Promise<AuditEntry[]>;
}
