import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { assertPersistedStatus, assertInvoiceCount } from "../support/assertions";

describe("Webhook idempotency & delivery-order robustness (mandatory)", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("the same event_id delivered twice results in the transition happening exactly once", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_dup_1").build();

    const first = await fixture.api.postWebhook(payload);
    const second = await fixture.api.postWebhook(payload);

    assert.equal(first.body.resulting_status, "active");
    assert.equal(second.status, 200);
    assert.equal(second.body.note, "duplicate event_id, already processed", "duplicate response is well-formed and self-describing");
    assertPersistedStatus(fixture, subId, "active");
  });

  it("a duplicate webhook does not create a duplicate invoice row", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];
    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_dup_2").build();

    await fixture.api.postWebhook(payload);
    await fixture.api.postWebhook(payload);
    await fixture.api.postWebhook(payload);

    assertInvoiceCount(fixture, subId, 1);
  });

  it("a duplicate webhook does not increment past_due retry count a second time", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const firstInvoice = fixture.invoices.findBySubscriptionId(subId)[0];
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 900).failed().withEventId("evt_first_fail").build());
    assertPersistedStatus(fixture, subId, "past_due");

    const retryInvoice = await fixture.service.attemptCharge(subId);
    const retryFailPayload = WebhookPayloadBuilder.forInvoice(subId, retryInvoice.id, 900).failed().withEventId("evt_retry_fail_dup").build();

    await fixture.api.postWebhook(retryFailPayload);
    assert.equal(fixture.subscriptions.findById(subId)!.retryCount, 1);

    await fixture.api.postWebhook(retryFailPayload); // redelivered
    await fixture.api.postWebhook(retryFailPayload); // redelivered again

    assert.equal(fixture.subscriptions.findById(subId)!.retryCount, 1, "retryCount must not be double-counted by redelivery");
    assertPersistedStatus(fixture, subId, "past_due"); // would be 'canceled' if the duplicates had counted
  });

  it("a payment.failed webhook arriving AFTER a payment.succeeded webhook for the SAME invoice does not regress an active subscription", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const subId = created.body.id;
    const invoice = fixture.invoices.findBySubscriptionId(subId)[0];

    const succeeded = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).succeeded().withEventId("evt_ooo_success").build();
    const staleFailed = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 900).failed().withEventId("evt_ooo_fail").build();

    const successRes = await fixture.api.postWebhook(succeeded);
    assert.equal(successRes.body.resulting_status, "active");

    const staleFailRes = await fixture.api.postWebhook(staleFailed); // different event_id, same invoice_id -- genuinely out-of-order, not a duplicate

    assert.equal(staleFailRes.body.resulting_status, "active", "must not regress to past_due");
    assertPersistedStatus(fixture, subId, "active");
    assert.equal(fixture.invoices.findById(invoice.id)!.status, "succeeded", "the earlier success must not be overwritten");
  });

  it("a payment.refunded webhook arriving out of order for an unsettled invoice is ignored, not treated as a fresh success", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const subId = created.body.id;
    const invoice = await fixture.service.attemptCharge(subId);

    const res = await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice.id, 4900).refunded().build());

    assert.equal(res.body.resulting_status, "trialing", "a refund before any success is meaningless and must not move state");
    assertPersistedStatus(fixture, subId, "trialing");
  });
});
