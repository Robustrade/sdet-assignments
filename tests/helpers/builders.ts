/**
 * Builders: start from a valid default, change only what the test cares about.
 *   aSubscriptionRequest().forCustomer(c).onPlan('pro').without('plan').build()
 *   aWebhook().paymentFailed().forInvoice(invoice).build()
 */
export class SubscriptionRequestBuilder {
  private body: Record<string, unknown> = { customer_id: 'cust_unknown', plan: 'basic', payment_method_id: 'pm_visa_4242' };

  forCustomer(customer: { id: string; paymentMethods: string[] }) {
    this.body.customer_id = customer.id;
    this.body.payment_method_id = customer.paymentMethods[0];
    return this;
  }
  onPlan(plan: string) { this.body.plan = plan; return this; }
  with(field: string, value: unknown) { this.body[field] = value; return this; }
  without(field: string) { delete this.body[field]; return this; }
  build() { return { ...this.body }; }
}

let eventCounter = 0;

export class WebhookBuilder {
  private event: Record<string, unknown> = {
    event_id: `evt_${++eventCounter}_${Date.now()}`,
    type: 'payment.succeeded',
    subscription_id: 'sub_unknown',
    invoice_id: 'inv_unknown',
    amount: 4900,
    currency: 'USD',
  };

  paymentSucceeded() { this.event.type = 'payment.succeeded'; return this; }
  paymentFailed() { this.event.type = 'payment.failed'; return this; }
  paymentRefunded() { this.event.type = 'payment.refunded'; return this; }
  /** Copy ids, amount and currency from a real invoice (as returned by the API). */
  forInvoice(invoice: { id: string; subscription_id: string; amount: number; currency: string }) {
    Object.assign(this.event, { invoice_id: invoice.id, subscription_id: invoice.subscription_id, amount: invoice.amount, currency: invoice.currency });
    return this;
  }
  with(field: string, value: unknown) { this.event[field] = value; return this; }
  without(field: string) { delete this.event[field]; return this; }
  build() { return { ...this.event }; }
}

export const aSubscriptionRequest = () => new SubscriptionRequestBuilder();
export const aWebhook = () => new WebhookBuilder();
