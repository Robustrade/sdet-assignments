import type { SubscriptionStatus } from '../../domain/SubscriptionStateMachine';
import type { AuditEventType, NotificationKind } from '../../domain/types';
import type { Database } from '../Database';

export interface WebhookEventRecord {
  eventId: string;
  type: string;
  subscriptionId: string | null;
  invoiceId: string | null;
  payload: string;
  outcome: 'applied' | 'ignored';
  reason: string | null;
  receivedAt: string;
}

export class WebhookEventRepository {
  constructor(private readonly db: Database) {}

  exists(eventId: string): boolean {
    return this.db.get('SELECT 1 FROM webhook_events WHERE event_id = ?', [eventId]) !== undefined;
  }

  insert(e: WebhookEventRecord): void {
    this.db.run(
      `INSERT INTO webhook_events (event_id, type, subscription_id, invoice_id, payload, outcome, reason, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.eventId, e.type, e.subscriptionId, e.invoiceId, e.payload, e.outcome, e.reason, e.receivedAt],
    );
  }

  recordDelivery(eventId: string, receivedAt: string, isDuplicate: boolean): void {
    this.db.run('INSERT INTO webhook_deliveries (event_id, received_at, is_duplicate) VALUES (?, ?, ?)', [
      eventId,
      receivedAt,
      isDuplicate ? 1 : 0,
    ]);
  }
}

export interface AuditEntry {
  subscriptionId: string;
  eventType: AuditEventType;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  cause: string | null;
  reference: string | null;
  detail?: string | null;
  atIso: string;
}

export class AuditLogRepository {
  constructor(private readonly db: Database) {}

  append(e: AuditEntry): void {
    this.db.run(
      `INSERT INTO audit_log (subscription_id, event_type, from_status, to_status, cause, reference, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.subscriptionId, e.eventType, e.fromStatus, e.toStatus, e.cause, e.reference, e.detail ?? null, e.atIso],
    );
  }
}

export class NotificationOutbox {
  constructor(
    private readonly db: Database,
    private readonly nextId: () => string,
  ) {}

  enqueue(subscriptionId: string, kind: NotificationKind, reference: string | null, atIso: string): void {
    this.db.run('INSERT INTO notifications (id, subscription_id, kind, reference, created_at) VALUES (?, ?, ?, ?, ?)', [
      this.nextId(),
      subscriptionId,
      kind,
      reference,
      atIso,
    ]);
  }
}
