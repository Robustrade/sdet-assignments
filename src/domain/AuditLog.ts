export interface AuditLog {
  id: string;
  subscriptionId: string;
  event: string;
  timestamp: Date;
}