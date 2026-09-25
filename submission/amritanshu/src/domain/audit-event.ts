export interface AuditEvent {
  id: string;
  subscriptionId: string;
  eventType: string;
  previousState?: string;
  nextState?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}