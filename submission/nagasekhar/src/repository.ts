
import type {
  Customer,
  Invoice,
  PaymentEvent,
  Plan,
  Subscription,
} from './models.js';

export class InMemoryRepository {
  private readonly customers = new Map<string, Customer>();
  private readonly plans = new Map<string, Plan>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly invoices = new Map<string, Invoice>();
  private readonly paymentEvents = new Map<string, PaymentEvent>();

  addCustomer(customer: Customer): void {
    this.customers.set(customer.id, { ...customer });
  }

  getCustomer(id: string): Customer | undefined {
    const customer = this.customers.get(id);
    return customer ? { ...customer } : undefined;
  }

  addPlan(plan: Plan): void {
    this.plans.set(plan.name, { ...plan });
  }

  getPlan(name: string): Plan | undefined {
    const plan = this.plans.get(name);
    return plan ? { ...plan } : undefined;
  }

  saveSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscription(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription } : undefined;
  }

  saveInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  getInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : undefined;
  }

  getInvoicesForSubscription(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.subscriptionId === subscriptionId)
      .map((invoice) => ({ ...invoice }));
  }

  savePaymentEvent(event: PaymentEvent): void {
    this.paymentEvents.set(event.eventId, { ...event });
  }

  getPaymentEvent(eventId: string): PaymentEvent | undefined {
    const event = this.paymentEvents.get(eventId);
    return event ? { ...event } : undefined;
  }

  getPaymentEventsForSubscription(
    subscriptionId: string,
  ): PaymentEvent[] {
    return [...this.paymentEvents.values()]
      .filter((event) => event.subscriptionId === subscriptionId)
      .map((event) => ({ ...event }));
  }

  clear(): void {
    this.customers.clear();
    this.plans.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.paymentEvents.clear();
  }
}
