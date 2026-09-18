import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { CustomerBuilder } from "../support/builders/CustomerBuilder";
import { assertPersistedStatus, assertApiAndPersistenceAgree, assertInvoiceCount } from "../support/assertions";

describe("Subscription creation & activation (Functional Expectation A)", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("creates a 'pro' subscription in trialing state and does NOT call the payment provider yet", async () => {
    const body = new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.known()).withPlan("pro").build();

    const res = await fixture.api.createSubscription(body);

    assert.equal(res.status, 201);
    assert.equal(res.body.status, "trialing");
    assert.equal(res.body.plan, "pro");
    assert.equal(fixture.paymentProvider.callCount, 0, "pro plan has a trial -- no charge at creation");
    assertApiAndPersistenceAgree(fixture, res.body.status, res.body.id);
    assertInvoiceCount(fixture, res.body.id, 0);
  });

  it("creates a 'basic' subscription and charges it immediately (0-day trial)", async () => {
    const body = new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.known()).withPlan("basic").build();

    const res = await fixture.api.createSubscription(body);

    assert.equal(res.status, 201);
    assert.equal(fixture.paymentProvider.callCount, 1, "basic plan charges on creation");
    const call = fixture.paymentProvider.calls[0];
    assert.equal(call.request.customerId, CustomerBuilder.known());
    assert.equal(call.request.amountCents, 900);
    assert.equal(call.request.currency, "USD");
    assert.equal(call.request.paymentMethodId, "pm_test_visa_4242");
    assertInvoiceCount(fixture, res.body.id, 1);
  });

  it("moves a 'basic' subscription from trialing to active once the provider-accepted charge is confirmed by webhook", async () => {
    const created = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("basic").build()
    );
    assert.equal(created.body.status, "trialing", "still awaiting webhook settlement right after creation");

    const invoice = fixture.invoices.findBySubscriptionId(created.body.id)[0];
    const webhookRes = await fixture.api.postWebhook(
      { event_id: "evt_activate_1", type: "payment.succeeded", subscription_id: created.body.id, invoice_id: invoice.id, amount: 900, currency: "USD" }
    );

    assert.equal(webhookRes.status, 200);
    assert.equal(webhookRes.body.resulting_status, "active");

    const fetched = await fixture.api.getSubscription(created.body.id);
    assert.equal(fetched.body.status, "active");
    assertPersistedStatus(fixture, created.body.id, "active");
  });

  it("persisted records and the API response agree at creation", async () => {
    const res = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const persisted = fixture.subscriptions.findById(res.body.id);

    assert.ok(persisted);
    assert.equal(persisted!.plan.name, res.body.plan);
    assert.equal(persisted!.customerId, res.body.customer_id);
    assert.equal(persisted!.status, res.body.status);
  });
});
