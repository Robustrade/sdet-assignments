import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { assertNoContradictoryInvoice, assertInvoiceCount } from "../support/assertions";

describe("Database validation: subscriptions, invoices, webhook_events", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("the subscription row reflects current state and plan at every stage, not just at creation", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;

    let row = fixture.subscriptions.findById(subId)!;
    assert.equal(row.status, "trialing");
    assert.equal(row.plan.name, "basic");

    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().build());
    row = fixture.subscriptions.findById(subId)!;
    assert.equal(row.status, "active");

    await fixture.api.cancelSubscription(subId);
    row = fixture.subscriptions.findById(subId)!;
    assert.equal(row.status, "canceled");
  });

  it("writes an invoice row for every billing attempt, with the correct amount and terminal status", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const subId = created.body.id;

    const invoice1 = await fixture.service.attemptCharge(subId);
    assert.equal(fixture.invoices.findById(invoice1.id)!.status, "pending");
    assert.equal(fixture.invoices.findById(invoice1.id)!.amountCents, 4900);

    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice1.id, 4900).succeeded().withEventId("evt_a").build());
    assert.equal(fixture.invoices.findById(invoice1.id)!.status, "succeeded");

    const invoice2 = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice2.id, 4900).failed().withEventId("evt_b").build());
    assert.equal(fixture.invoices.findById(invoice2.id)!.status, "failed");
    assert.equal(fixture.invoices.findById(invoice2.id)!.failureReason, "payment_failed_webhook");

    assertInvoiceCount(fixture, subId, 2);
  });

  it("records a provider-side decline/timeout directly on the invoice without waiting for a webhook", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const subId = created.body.id;
    fixture.paymentProvider.setDefaultOutcome("decline");

    const invoice = await fixture.service.attemptCharge(subId);

    assert.equal(invoice.status, "failed");
    assert.equal(invoice.failureReason, "provider_declined");
    assert.equal(fixture.subscriptions.findById(subId)!.status, "past_due");
  });

  it("records every webhook delivery (including duplicates), but only counts a unique event_id once toward idempotency", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_dup_db").build();

    await fixture.api.postWebhook(payload);
    await fixture.api.postWebhook(payload); // exact redelivery

    const deliveries = fixture.webhookEvents.deliveriesForSubscription(subId);
    assert.equal(deliveries.length, 2, "both delivery attempts are recorded for audit");
    assert.equal(deliveries[0].outcome, "applied");
    assert.equal(deliveries[1].outcome, "duplicate");
    assert.equal(fixture.webhookEvents.hasBeenProcessed("evt_dup_db"), true);

    // Duplicate delivery must not create a second invoice.
    assertInvoiceCount(fixture, subId, 1);
  });

  it("never leaves a contradictory record: an 'active' subscription always has at least one succeeded invoice", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_contra").build());

    assertNoContradictoryInvoice(fixture, subId);
  });
});
