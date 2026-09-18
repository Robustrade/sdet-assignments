import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { assertPersistedStatus } from "../support/assertions";

describe("State-machine: invalid transitions are rejected or safely ignored", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("[webhook-driven] a payment.succeeded webhook for an already-canceled subscription does NOT reactivate it", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const subId = created.body.id;
    await fixture.api.cancelSubscription(subId);
    assertPersistedStatus(fixture, subId, "canceled");

    // Forge an invoice reference by charging first (illustrates that even a subscription with
    // a legitimate pending invoice cannot be reactivated once canceled).
    const invoice = await fixture.service.attemptCharge(subId).catch(() => null);
    // attemptCharge itself refuses to charge a canceled subscription (defense in depth) --
    // so we build a webhook against a *fabricated* invoice id to prove the state machine
    // itself is the backstop even if an invoice existed.
    assert.equal(invoice, null, "attemptCharge must also refuse a canceled subscription directly");

    const res = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, "inv_does_not_exist", 4900).succeeded().build()
    );

    // No matching invoice exists (because attemptCharge correctly refused to create one), so
    // this is rejected at the lookup stage -- which is itself proof no reactivation occurred.
    assert.equal(res.status, 404);
    assertPersistedStatus(fixture, subId, "canceled");
  });

  it("[webhook-driven] a payment.succeeded webhook for an already-canceled subscription is ignored even against a real prior invoice", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0]; // created synchronously by the basic-plan charge at creation

    await fixture.api.cancelSubscription(subId);
    assertPersistedStatus(fixture, subId, "canceled");

    const res = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_stray_success").build()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.resulting_status, "canceled", "CanceledState has no code path to ActiveState");
    assertPersistedStatus(fixture, subId, "canceled");
  });

  it("[API-driven] canceling an already-canceled subscription is rejected (409) and does not change state", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const subId = created.body.id;

    const first = await fixture.api.cancelSubscription(subId);
    assert.equal(first.status, 200);

    const second = await fixture.api.cancelSubscription(subId);
    assert.equal(second.status, 409);
    assertPersistedStatus(fixture, subId, "canceled");
  });

  it("[webhook-driven] a payment.failed webhook for an already-canceled subscription does not move it to past_due", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    await fixture.api.cancelSubscription(subId);

    const res = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).failed().withEventId("evt_stray_fail").build()
    );

    assert.equal(res.body.resulting_status, "canceled");
    assertPersistedStatus(fixture, subId, "canceled");
  });
});
