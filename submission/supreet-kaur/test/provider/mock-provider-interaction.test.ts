import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { CustomerBuilder } from "../support/builders/CustomerBuilder";

describe("Mocked payment provider interaction (Functional Expectation F)", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("is called exactly once for a genuine billing attempt, with the correct amount/customer/payment method/idempotency key", async () => {
    const created = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.known()).withPlan("basic").withPaymentMethod("pm_test_visa_4242").build()
    );

    assert.equal(fixture.paymentProvider.callCount, 1);
    const call = fixture.paymentProvider.calls[0];
    assert.equal(call.request.customerId, CustomerBuilder.known());
    assert.equal(call.request.amountCents, 900);
    assert.equal(call.request.currency, "USD");
    assert.equal(call.request.paymentMethodId, "pm_test_visa_4242");

    const invoice = fixture.invoices.findBySubscriptionId(created.body.id)[0];
    assert.equal(call.request.idempotencyKey, invoice.id, "the provider is given the invoice id as its idempotency key");
  });

  it("is NOT called when subscription creation is rejected by validation", async () => {
    await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("does-not-exist").build());
    assert.equal(fixture.paymentProvider.callCount, 0);
  });

  it("is NOT called again when a webhook event is merely replayed (duplicate delivery)", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    assert.equal(fixture.paymentProvider.callCount, 1, "the one genuine charge at creation");

    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_replay").build();

    await fixture.api.postWebhook(payload);
    await fixture.api.postWebhook(payload);
    await fixture.api.postWebhook(payload);

    assert.equal(fixture.paymentProvider.callCount, 1, "webhooks settle an existing invoice; they never call the provider themselves");
  });

  it("behaves correctly when the mock reports a synchronous decline", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    fixture.paymentProvider.setDefaultOutcome("decline");

    const invoice = await fixture.service.attemptCharge(created.body.id);

    assert.equal(fixture.paymentProvider.callCount, 1);
    assert.equal(invoice.status, "failed");
    assert.equal(invoice.providerChargeId, null, "a declined attempt never receives a provider charge id");
    const sub = await fixture.api.getSubscription(created.body.id);
    assert.equal(sub.body.status, "past_due");
  });

  it("behaves correctly when the mock reports a timeout", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    fixture.paymentProvider.setDefaultOutcome("timeout");

    const invoice = await fixture.service.attemptCharge(created.body.id);

    assert.equal(fixture.paymentProvider.callCount, 1);
    assert.equal(invoice.status, "failed");
    assert.equal(invoice.failureReason, "provider_timeout");
    const sub = await fixture.api.getSubscription(created.body.id);
    assert.equal(sub.body.status, "past_due");
  });

  it("behaves correctly when the mock reports success (invoice stays pending until webhook confirmation)", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    fixture.paymentProvider.setDefaultOutcome("accept");

    const invoice = await fixture.service.attemptCharge(created.body.id);

    assert.equal(invoice.status, "pending");
    assert.ok(invoice.providerChargeId, "an accepted attempt receives a provider charge id");
    const sub = await fixture.api.getSubscription(created.body.id);
    assert.equal(sub.body.status, "trialing", "settlement is webhook-driven, not implied by acceptance");
  });

  it("supports per-customer outcomes so one test can exercise both a healthy and a failing customer", async () => {
    fixture.paymentProvider.setOutcomeForCustomer("cust_002", "decline");

    const healthy = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withCustomer("cust_001").withPlan("basic").build());
    const failing = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withCustomer("cust_002").withPlan("basic").build());

    assert.equal(fixture.paymentProvider.callCount, 2);
    assert.equal((await fixture.api.getSubscription(healthy.body.id)).body.status, "trialing");
    assert.equal((await fixture.api.getSubscription(failing.body.id)).body.status, "past_due");
  });
});
