import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";

describe("Webhook endpoint request handling (transport/shape, not business logic)", () => {
  let fixture: TestFixture;
  let subscriptionId: string;
  let invoiceId: string;

  beforeEach(async () => {
    fixture = await TestFixture.start();
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    subscriptionId = created.body.id;
    invoiceId = fixture.invoices.findBySubscriptionId(subscriptionId)[0].id;
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("accepts a well-formed, correctly-signed payload", async () => {
    const payload = WebhookPayloadBuilder.forInvoice(subscriptionId, invoiceId, 900).succeeded().build();
    const res = await fixture.api.postWebhook(payload);
    assert.equal(res.status, 200);
  });

  it("rejects a payload with a signature computed from the wrong body (tampered) with 401", async () => {
    const payload = WebhookPayloadBuilder.forInvoice(subscriptionId, invoiceId, 900).succeeded().build();
    const rawBody = JSON.stringify(payload);
    const wrongSignature = fixture.signature.sign(JSON.stringify({ ...payload, amount: 999999 }));

    const res = await fixture.api.postWebhook(payload, { rawBodyOverride: rawBody, signatureOverride: wrongSignature });

    assert.equal(res.status, 401);
    assert.match(res.body.error, /signature/i);
    // Rejected-at-the-door deliveries are still recorded for audit, but never applied.
    const deliveries = fixture.webhookEvents.deliveriesForSubscription(subscriptionId);
    assert.equal(deliveries.length, 0, "a signature-rejected delivery can't even be attributed to a subscription");
  });

  it("rejects a payload with a missing signature header with 401", async () => {
    const payload = WebhookPayloadBuilder.forInvoice(subscriptionId, invoiceId, 900).succeeded().build();
    const res = await fixture.api.postWebhook(payload, { rawBodyOverride: JSON.stringify(payload), signatureOverride: null });
    assert.equal(res.status, 401);
  });

  it("rejects a body that is not valid JSON with 400, even when correctly signed", async () => {
    const rawBody = "{not-json-at-all";
    const res = await fixture.api.postWebhook(null, { rawBodyOverride: rawBody, signatureOverride: fixture.signature.sign(rawBody) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /json/i);
  });

  it("rejects a well-formed JSON payload missing required fields with 400", async () => {
    const rawBody = JSON.stringify({ type: "payment.succeeded" }); // missing event_id, subscription_id, invoice_id, amount, currency
    const res = await fixture.api.postWebhook(null, { rawBodyOverride: rawBody, signatureOverride: fixture.signature.sign(rawBody) });
    assert.equal(res.status, 400);
  });

  it("rejects an unknown event type with 400", async () => {
    const payload = WebhookPayloadBuilder.forInvoice(subscriptionId, invoiceId, 900).ofType("payment.mystery_event").build();
    const res = await fixture.api.postWebhook(payload);
    assert.equal(res.status, 400);
  });

  it("returns 404 for a webhook referencing an unknown subscription_id", async () => {
    const payload = WebhookPayloadBuilder.forInvoice("sub_does_not_exist", invoiceId, 900).succeeded().build();
    const res = await fixture.api.postWebhook(payload);
    assert.equal(res.status, 404);
  });

  it("returns 404 for a webhook referencing an unknown invoice_id", async () => {
    const payload = WebhookPayloadBuilder.forInvoice(subscriptionId, "inv_does_not_exist", 900).succeeded().build();
    const res = await fixture.api.postWebhook(payload);
    assert.equal(res.status, 404);
  });
});
