import { expect } from '@playwright/test';
import { Customer, Database } from '../../src/database';
import { aSubscriptionRequest } from './builders';
import { ApiClient } from './clients';
import { MockPaymentProvider } from './mockPaymentProvider';
import { TestClock } from './testClock';

/**
 * Ready-made starting points: "given an active pro subscription...".
 * They use the REAL API only, never write to the database directly,
 * so every starting state is one the system can really reach.
 */
export class Given {
  constructor(private api: ApiClient, private db: Database, private provider: MockPaymentProvider, private clock: TestClock) {}

  newCustomer(): Customer {
    const customer = { id: this.db.newId('cust'), paymentMethods: ['pm_visa_4242'] };
    this.db.addCustomer(customer);
    return customer;
  }

  async trialingBasic() {
    const customer = this.newCustomer();
    const res = await this.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());
    expect(res.body.status).toBe('trialing');
    return { customer, sub: res.body };
  }

  async basicWithTrialEnded() {
    const given = await this.trialingBasic();
    this.clock.advanceDays(14);
    return given;
  }

  async activePro() {
    const customer = this.newCustomer();
    this.provider.willSucceed();
    const res = await this.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    expect(res.body.status).toBe('active');
    return { customer, sub: res.body, invoice: await this.lastInvoice(res.body.id) };
  }

  async pastDue() {
    const { customer, sub } = await this.activePro();
    this.provider.willDecline();
    const res = await this.api.charge(sub.id);
    expect(res.body.subscription.status).toBe('past_due');
    return { customer, sub: res.body.subscription, invoice: res.body.invoice };
  }

  async canceled() {
    const { customer, sub } = await this.activePro();
    const res = await this.api.cancel(sub.id);
    expect(res.body.status).toBe('canceled');
    return { customer, sub: res.body };
  }

  /** Pro signup where the provider timed out: subscription still trialing, invoice pending. */
  async proWithPaymentInProgress() {
    const customer = this.newCustomer();
    this.provider.willTimeout();
    const res = await this.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    const invoice = await this.lastInvoice(res.body.id);
    expect(invoice.status).toBe('pending');
    return { customer, sub: res.body, invoice };
  }

  async lastInvoice(subscriptionId: string) {
    const res = await this.api.getInvoices(subscriptionId);
    return res.body[res.body.length - 1];
  }
}
