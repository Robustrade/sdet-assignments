export interface AuditEvent {
  id: string;
  subscriptionId: string;
  eventType: string;
  fromStatus?: string;
  toStatus?: string;
  details?: string;
  createdAt: Date;
}