import assert from 'node:assert/strict';
import type { BillingRepository } from '../../src/repository.ts';
import type { Invoice, Status } from '../../src/domain.ts';
import type { SubscriptionApiClient } from './client.ts';
import type { MockPaymentProvider } from './harness.ts';

export class BillingVerifier {
  constructor(
    private readonly repo: BillingRepository,
    private readonly api: SubscriptionApiClient,
    private readonly provider: MockPaymentProvider,
  ) {}
  async state(id: string, expected: Status): Promise<void> {
    const response = await this.api.get(id);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {...this.repo.subscription(id)!});
    assert.equal(response.body.status, expected);
    assert.ok(response.body.created_at <= response.body.updated_at);
    const invoices = this.repo.invoices(id);
    const payments = this.repo.payments(id);
    if (expected === 'active') assert.ok(payments.some(p => p.status === 'succeeded'));
    for (const invoice of invoices) {
      const outcomes = payments.filter(p => p.invoice_id === invoice.id).map(p => p.status);
      if (invoice.status === 'pending') assert.deepEqual(outcomes, []);
      if (invoice.status === 'paid') assert.ok(outcomes.includes('succeeded'));
      if (invoice.status === 'failed') {
        assert.ok(outcomes.includes('failed')); assert.ok(!outcomes.includes('succeeded'));
      }
      if (invoice.status === 'refunded') {
        assert.ok(outcomes.includes('succeeded')); assert.ok(outcomes.includes('refunded'));
      }
      assert.equal(invoice.subscription_id, id); assert.ok(invoice.amount > 0);
      assert.equal(invoice.currency, 'USD');
      assert.ok(invoice.created_at >= response.body.created_at);
      assert.ok(invoice.updated_at >= invoice.created_at);
    }
    assert.equal(new Set(invoices.map(i => i.sequence)).size, invoices.length);
    assert.equal(new Set(payments.map(p => `${p.invoice_id}:${p.status}`)).size, payments.length);
    for (const payment of payments) {
      const invoice = invoices.find(i => i.id === payment.invoice_id)!;
      assert.ok(payment.created_at >= invoice.created_at);
      assert.ok(payment.created_at <= invoice.updated_at);
    }
    let state = '';
    for (const audit of this.repo.audits(id)) {
      assert.equal(audit.from_status, state);
      if (state === 'canceled') assert.equal(audit.to_status, 'canceled');
      assert.ok(audit.created_at >= response.body.created_at);
      state = audit.to_status;
    }
    assert.equal(state, expected);
    for (const event of this.repo.events(id)) {
      assert.ok(invoices.some(i => i.id === event.invoice_id));
      assert.ok(['applied','ignored'].includes(event.outcome));
      assert.ok(event.received_at >= this.repo.invoice(event.invoice_id)!.created_at);
    }
  }
  charge(invoice: Invoice, count = 1): void {
    const s = this.repo.subscription(invoice.subscription_id)!;
    assert.equal(this.provider.calls.length, count);
    assert.deepEqual(this.provider.calls[count - 1], {
      customerId: s.customer_id, paymentMethodId: s.payment_method_id,
      amount: invoice.amount, currency: 'USD', invoiceId: invoice.id, idempotencyKey: invoice.id,
    });
  }
  financialSnapshot(id: string) {
    return {
      subscription: this.repo.subscription(id), invoices: this.repo.invoices(id),
      payments: this.repo.payments(id), audits: this.repo.audits(id), providerCalls: this.provider.calls.length,
    };
  }
  unchanged(id: string, before: ReturnType<BillingVerifier['financialSnapshot']>): void {
    assert.deepEqual(this.financialSnapshot(id), before);
  }
}
