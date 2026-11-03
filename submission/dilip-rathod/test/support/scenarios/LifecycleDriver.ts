import type { InvoiceDto, SubscriptionDto } from '../api/contracts';
import { aSubscriptionRequest } from '../builders/builders';
import type { CustomerSeed } from '../builders/builders';
import type { TestEnvironment } from '../env/TestEnvironment';

export interface SubscriptionWithInvoice {
  subscription: SubscriptionDto;
  invoice: InvoiceDto;
}

/**
 * "Given" steps that put a subscription into a lifecycle state using only the public API,
 * the billing job and signed webhooks — never by writing rows. A test therefore cannot start
 * from a state the service could not have produced on its own.
 */
export class LifecycleDriver {
  constructor(private readonly env: TestEnvironment) {}

  async trialing(customer: CustomerSeed = this.env.seed.customer()): Promise<SubscriptionDto> {
    const sub = await this.env.api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    if (sub.status !== 'trialing') throw new Error(`Given: expected trialing, got ${sub.status}`);
    return sub;
  }

  /** A pro subscription whose trial has ended and whose first charge is awaiting a webhook. */
  async awaitingFirstChargeOutcome(): Promise<SubscriptionWithInvoice> {
    const trialing = await this.trialing();
    this.env.provider.willReturnPending();
    await this.billAt(trialing.next_billing_at!);
    return this.withLatestInvoice(trialing.id, 'trialing');
  }

  async active(plan: 'pro' | 'basic' = 'pro'): Promise<SubscriptionDto> {
    let sub: SubscriptionDto;
    if (plan === 'basic') {
      this.env.provider.willSucceed();
      sub = await this.env.api.create(aSubscriptionRequest().forCustomer(this.env.seed.customer()).onPlan('basic').build());
    } else {
      const trialing = await this.trialing();
      this.env.provider.willSucceed();
      await this.billAt(trialing.next_billing_at!);
      sub = await this.env.api.get(trialing.id);
    }
    if (sub.status !== 'active') throw new Error(`Given: expected active, got ${sub.status}`);
    return sub;
  }

  /** Active, at its renewal date, with the renewal charge awaiting a webhook. */
  async awaitingRenewalOutcome(): Promise<SubscriptionWithInvoice> {
    const active = await this.active();
    this.env.provider.willReturnPending();
    await this.billAt(active.next_billing_at!);
    return this.withLatestInvoice(active.id, 'active');
  }

  async pastDue(plan: 'pro' | 'basic' = 'pro'): Promise<SubscriptionWithInvoice> {
    let id: string;
    if (plan === 'basic') {
      this.env.provider.willDecline();
      id = (await this.env.api.create(aSubscriptionRequest().forCustomer(this.env.seed.customer()).onPlan('basic').build())).id;
    } else {
      const trialing = await this.trialing();
      this.env.provider.willDecline();
      await this.billAt(trialing.next_billing_at!);
      id = trialing.id;
    }
    return this.withLatestInvoice(id, 'past_due');
  }

  /** Past due, at its retry date, with the retry charge awaiting a webhook. */
  async awaitingRetryOutcome(): Promise<SubscriptionWithInvoice> {
    const { subscription } = await this.pastDue();
    this.env.provider.willReturnPending();
    await this.billAt(subscription.next_billing_at!);
    return this.withLatestInvoice(subscription.id, 'past_due');
  }

  async canceled(): Promise<SubscriptionDto> {
    const trialing = await this.trialing();
    return this.env.api.cancel(trialing.id);
  }

  /** Moves the clock to `instant` (if it is in the future) and runs the billing job. */
  async billAt(instant: string) {
    if (instant > this.env.clock.iso()) this.env.clock.setTo(instant);
    return this.env.api.runBilling();
  }

  async latestInvoice(subscriptionId: string): Promise<InvoiceDto> {
    const invoices = await this.env.api.invoices(subscriptionId);
    const latest = invoices.at(-1);
    if (!latest) throw new Error(`Subscription ${subscriptionId} has no invoices`);
    return latest;
  }

  private async withLatestInvoice(id: string, expectedStatus: SubscriptionDto['status']): Promise<SubscriptionWithInvoice> {
    const subscription = await this.env.api.get(id);
    if (subscription.status !== expectedStatus) throw new Error(`Given: expected ${expectedStatus}, got ${subscription.status}`);
    return { subscription, invoice: await this.latestInvoice(id) };
  }
}
