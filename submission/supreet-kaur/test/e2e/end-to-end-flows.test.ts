import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { CustomerBuilder } from "../support/builders/CustomerBuilder";
import { assertPersistedStatus, assertApiAndPersistenceAgree, assertNoContradictoryInvoice } from "../support/assertions";

/**
 * These tests deliberately don't introduce anything new -- they replay realistic multi-step
 * customer journeys through the SAME seams (API client, mock provider, repositories) the
 * narrower tests use individually, to prove the pieces actually compose: request -> service ->
 * provider call -> webhook settlement -> persistence -> API-visible result.
 */
describe("End-to-end flows", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("pro-plan customer: trial -> activates -> has a billing hiccup -> recovers -> cancels", async () => {
    // 1. Create a pro subscription. Trial, no charge yet.
    const created = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.known()).withPlan("pro").build()
    );
    const subId = created.body.id;
    assert.equal(created.body.status, "trialing");
    assert.equal(fixture.paymentProvider.callCount, 0);

    // 2. Trial ends -> first charge attempt -> provider accepts -> webhook confirms -> active.
    const firstInvoice = await fixture.service.attemptCharge(subId);
    assert.equal(fixture.paymentProvider.callCount, 1);
    const activateRes = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 4900).succeeded().withEventId("evt_e2e_1").build()
    );
    assert.equal(activateRes.body.resulting_status, "active");
    assertApiAndPersistenceAgree(fixture, "active", subId);
    assertNoContradictoryInvoice(fixture, subId);

    // 3. The payment provider redelivers the SAME event (network hiccup on their end).
    //    Must be a total no-op: no new provider call, no new invoice, no state change.
    const replay = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 4900).succeeded().withEventId("evt_e2e_1").build()
    );
    assert.equal(replay.body.note, "duplicate event_id, already processed");
    assert.equal(fixture.paymentProvider.callCount, 1, "no provider call for a replayed webhook");
    assert.equal(fixture.invoices.findBySubscriptionId(subId).length, 1);

    // 4. Next billing cycle: recurring charge fails.
    const recurringInvoice = await fixture.service.attemptCharge(subId);
    const failRes = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, recurringInvoice.id, 4900).failed().withEventId("evt_e2e_2").build()
    );
    assert.equal(failRes.body.resulting_status, "past_due");
    assertPersistedStatus(fixture, subId, "past_due");

    // 5. Retry succeeds -> back to active.
    const retryInvoice = await fixture.service.attemptCharge(subId);
    const recoverRes = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, retryInvoice.id, 4900).succeeded().withEventId("evt_e2e_3").build()
    );
    assert.equal(recoverRes.body.resulting_status, "active");
    assertNoContradictoryInvoice(fixture, subId);

    // 6. Customer cancels. Stops future billing; a stray late webhook afterwards has no effect.
    const cancelRes = await fixture.api.cancelSubscription(subId);
    assert.equal(cancelRes.body.status, "canceled");

    const strayWebhook = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, retryInvoice.id, 4900).succeeded().withEventId("evt_e2e_late").build()
    );
    assert.equal(strayWebhook.body.resulting_status, "canceled");
    assertPersistedStatus(fixture, subId, "canceled");

    // Final audit trail sanity: every real transition is attributable and in order. (Ignored
    // events -- like the stray webhook above -- are also logged for audit, but they're no-ops
    // where `from === to`, so we filter those out here to check only genuine transitions.)
    const persisted = fixture.subscriptions.findById(subId)!;
    const statusSequence = persisted.auditLog.filter((e) => e.from !== e.to).map((e) => e.to);
    assert.deepEqual(statusSequence, ["trialing", "active", "past_due", "active", "canceled"]);
  });

  it("basic-plan customer: charged at signup, provider declines synchronously -> past_due immediately, no webhook needed", async () => {
    fixture.paymentProvider.setDefaultOutcome("decline");

    const created = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.secondKnown()).withPlan("basic").build()
    );

    assert.equal(fixture.paymentProvider.callCount, 1);
    assert.equal(created.body.status, "past_due", "the synchronous decline resolves before the HTTP response is even sent");

    const fetched = await fixture.api.getSubscription(created.body.id);
    assert.equal(fetched.body.status, "past_due");
    assertApiAndPersistenceAgree(fixture, fetched.body.status, created.body.id);
  });
});
