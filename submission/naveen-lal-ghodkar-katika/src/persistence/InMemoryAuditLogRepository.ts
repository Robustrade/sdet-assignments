import type { AuditEntry } from '../domain/AuditEntry';
import type { AuditLogRepository } from './AuditLogRepository';

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async listBySubscription(subscriptionId: string): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => entry.subscriptionId === subscriptionId).map((entry) => ({ ...entry }));
  }

  async list(): Promise<AuditEntry[]> {
    return this.entries.map((entry) => ({ ...entry }));
  }
}
