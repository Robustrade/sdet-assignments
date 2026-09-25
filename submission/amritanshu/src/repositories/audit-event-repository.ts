import type { AuditEvent } from "../domain/audit-event.js";

export interface AuditEventRepository {
  save(event: AuditEvent): void;
  findBySubscriptionId(subscriptionId: string): AuditEvent[];
}