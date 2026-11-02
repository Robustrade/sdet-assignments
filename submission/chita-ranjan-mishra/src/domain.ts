export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type InvoiceStatus = "pending" | "paid" | "failed" | "refunded";

export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface Plan {
  id: string;
  amount: number;
  currency: string;
  trialDays: number;
}

export interface SubscriptionData {
  id: string;
  customerId: string;
  planId: string;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [],
};

export class SubscriptionLifecycle {
  static canTransition(
    from: SubscriptionStatus,
    to: SubscriptionStatus,
  ): boolean {
    return transitions[from].includes(to);
  }
}

export class Subscription {
  readonly id: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly trialEndsAt: string | null;
  readonly createdAt: string;
  private currentPlanId: string;
  private currentStatus: SubscriptionStatus;
  private failures = 0;
  private lastUpdatedAt: string;

  constructor(data: SubscriptionData) {
    this.id = data.id;
    this.customerId = data.customerId;
    this.currentPlanId = data.planId;
    this.paymentMethodId = data.paymentMethodId;
    this.currentStatus = data.status;
    this.trialEndsAt = data.trialEndsAt;
    this.failures = data.retryCount;
    this.createdAt = data.createdAt;
    this.lastUpdatedAt = data.updatedAt;
  }

  get status(): SubscriptionStatus {
    return this.currentStatus;
  }

  get planId(): string {
    return this.currentPlanId;
  }

  get retryCount(): number {
    return this.failures;
  }

  get updatedAt(): string {
    return this.lastUpdatedAt;
  }

  transition(to: SubscriptionStatus, updatedAt: string): void {
    if (!SubscriptionLifecycle.canTransition(this.currentStatus, to)) {
      throw new Error(
        `Invalid subscription transition: ${this.currentStatus} -> ${to}`,
      );
    }

    this.currentStatus = to;
    this.lastUpdatedAt = updatedAt;
  }

  recordFailedAttempt(updatedAt: string): void {
    this.failures += 1;
    this.lastUpdatedAt = updatedAt;
  }

  resetFailedAttempts(updatedAt: string): void {
    this.failures = 0;
    this.lastUpdatedAt = updatedAt;
  }

  changePlan(planId: string, updatedAt: string): void {
    this.currentPlanId = planId;
    this.lastUpdatedAt = updatedAt;
  }

  toJSON(): SubscriptionData {
    return {
      id: this.id,
      customerId: this.customerId,
      planId: this.currentPlanId,
      paymentMethodId: this.paymentMethodId,
      status: this.currentStatus,
      trialEndsAt: this.trialEndsAt,
      retryCount: this.failures,
      createdAt: this.createdAt,
      updatedAt: this.lastUpdatedAt,
    };
  }
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEvent {
  eventId: string;
  type: PaymentEventType;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  attemptNumber?: number;
}

export interface WebhookEventRecord {
  eventId: string;
  type: PaymentEventType;
  subscriptionId: string;
  invoiceId: string;
  firstReceivedAt: string;
  deliveryCount: number;
  duplicateDeliveries: number;
  outcome: "received" | "processed" | "ignored";
}

export interface WebhookDeliveryRecord {
  eventId: string;
  receivedAt: string;
  duplicate: boolean;
}

export interface AuditRecord {
  id: string;
  subscriptionId: string;
  action: string;
  fromStatus?: SubscriptionStatus;
  toStatus?: SubscriptionStatus;
  referenceId?: string;
  occurredAt: string;
}
