import type { Customer } from "../domain/customer.js";
import type { Plan, PlanId } from "../domain/plan.js";
import type { CustomerRepository } from "./customer-repository.js";
import type { PlanRepository } from "./plan-repository.js";

import type { AuditEvent } from "../domain/audit-event.js";
import type { Invoice } from "../domain/invoice.js";
import type { Payment } from "../domain/payment.js";
import type { Subscription } from "../domain/subscription.js";
import type { WebhookEvent } from "../domain/webhook-event.js";

import type { SubscriptionRepository } from "./subscription-repository.js";
import type { InvoiceRepository } from "./invoice-repository.js";
import type { PaymentRepository } from "./payment-repository.js";
import type { WebhookEventRepository } from "./webhook-event-repository.js";
import type { AuditEventRepository } from "./audit-event-repository.js";

export class InMemorySubscriptionRepository
  implements SubscriptionRepository
{
  private readonly subscriptions = new Map<string, Subscription>();

  save(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  findById(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  findByCustomerId(customerId: string): Subscription[] {
    return [...this.subscriptions.values()].filter(
      (subscription) => subscription.customerId === customerId,
    );
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly invoices = new Map<string, Invoice>();

  save(invoice: Invoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  findById(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  findBySubscriptionId(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()].filter(
      (invoice) => invoice.subscriptionId === subscriptionId,
    );
  }
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, Payment>();

  save(payment: Payment): void {
    this.payments.set(payment.id, payment);
  }

  findById(id: string): Payment | undefined {
    return this.payments.get(id);
  }

  findByInvoiceId(invoiceId: string): Payment[] {
    return [...this.payments.values()].filter(
      (payment) => payment.invoiceId === invoiceId,
    );
  }

  findBySubscriptionId(subscriptionId: string): Payment[] {
    return [...this.payments.values()].filter(
      (payment) => payment.subscriptionId === subscriptionId,
    );
  }
}

export class InMemoryWebhookEventRepository
  implements WebhookEventRepository
{
  private readonly events = new Map<string, WebhookEvent>();

  save(event: WebhookEvent): void {
    this.events.set(event.eventId, event);
  }

  findByEventId(eventId: string): WebhookEvent | undefined {
    return this.events.get(eventId);
  }
}

export class InMemoryAuditEventRepository
  implements AuditEventRepository
{
  private readonly events: AuditEvent[] = [];

  save(event: AuditEvent): void {
    this.events.push(event);
  }

  findBySubscriptionId(subscriptionId: string): AuditEvent[] {
    return this.events.filter(
      (event) => event.subscriptionId === subscriptionId,
    );
  }
}export class InMemoryCustomerRepository
  implements CustomerRepository
{
  private readonly customers = new Map<string, Customer>();

  save(customer: Customer): void {
    this.customers.set(customer.id, customer);
  }

  findById(id: string): Customer | undefined {
    return this.customers.get(id);
  }
}

export class InMemoryPlanRepository implements PlanRepository {
  private readonly plans = new Map<PlanId, Plan>();

  save(plan: Plan): void {
    this.plans.set(plan.id, plan);
  }

  findById(id: PlanId): Plan | undefined {
    return this.plans.get(id);
  }
}