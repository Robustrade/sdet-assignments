import type { SubscriptionStatus } from "../domain/Subscription";

export interface AuditEvent { id: string; subscriptionId: string; fromStatus: SubscriptionStatus | null; toStatus: SubscriptionStatus; reason: string; occurredAt: string; }