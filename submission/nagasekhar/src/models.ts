
import type { SubscriptionStatus } from './state-machine.js';

export type PlanName = 'basic' | 'pro';

export interface Customer {
  id: string;
  email: string;
}

export interface Plan {
  name: PlanName;
  price: number;
  currency: 'USD';
  trialDays: number;
  chargeImmediately: boolean;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanName;
  paymentMethodId: string;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
  trialEndsAt: string | null;
}

export type InvoiceStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: 'USD';
  status: InvoiceStatus;
  providerReference: string | null;
  createdAt: string;
}

export interface PaymentEvent {
  eventId: string;
  subscriptionId: string;
  invoiceId: string;
  type:
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.refunded';
  receivedAt: string;
  processed: boolean;
}
