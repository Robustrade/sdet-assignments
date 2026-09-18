import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { WebhookPayloadBuilder } from "../support/builders/WebhookPayloadBuilder";
import { assertPersistedStatus } from "../support/assertions";

/**
 * Every arrow in the lifecycle diagram from SDET_ASSIGNMENT.md gets its own test below, each
 * named after the transition it proves. Together they are the full lifecycle diagram:
 *
 *   trialing --(charge succeeds)--> active
 *   trialing --(charge fails)-----> past_due
 *   active   --(charge fails)-----> past_due
 *   past_due --(retry succeeds)---> active
 *   past_due --(retries exhausted)-> canceled
 *   active   --(cancel)-----------> canceled
 *   trialing --(cancel)-----------> canceled
 */
describe("State-machine: every valid lifecycle transition", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  async function createProSubscription() {
    const res = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    return res.body.id as string;
  }

  it("trialing -> active: trial ends, first charge succeeds", async () => {
    const subId = await createProSubscription();
    const invoice = await fixture.service.attemptCharge(subId); // simulates the scheduler firing when the trial ends

    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 4900).succeeded().withEventId("evt_1").build();
    const res = await fixture.api.postWebhook(payload);

    assert.equal(res.body.resulting_status, "active");
    assertPersistedStatus(fixture, subId, "active");
  });

  it("trialing -> past_due: trial ends, first charge fails", async () => {
    const subId = await createProSubscription();
    const invoice = await fixture.service.attemptCharge(subId);

    const payload = WebhookPayloadBuilder.forInvoice(subId, invoice.id, 4900).failed().withEventId("evt_2").build();
    const res = await fixture.api.postWebhook(payload);

    assert.equal(res.body.resulting_status, "past_due");
    assertPersistedStatus(fixture, subId, "past_due");
  });

  it("active -> past_due: a recurring charge fails", async () => {
    const subId = await createProSubscription();
    const firstInvoice = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 4900).succeeded().withEventId("evt_3a").build()
    );
    assertPersistedStatus(fixture, subId, "active");

    const recurringInvoice = await fixture.service.attemptCharge(subId); // simulates next billing cycle
    const res = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, recurringInvoice.id, 4900).failed().withEventId("evt_3b").build()
    );

    assert.equal(res.body.resulting_status, "past_due");
    assertPersistedStatus(fixture, subId, "past_due");
  });

  it("past_due -> active: a retry charge succeeds", async () => {
    const subId = await createProSubscription();
    const firstInvoice = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 4900).failed().withEventId("evt_4a").build()
    );
    assertPersistedStatus(fixture, subId, "past_due");

    const retryInvoice = await fixture.service.attemptCharge(subId);
    const res = await fixture.api.postWebhook(
      WebhookPayloadBuilder.forInvoice(subId, retryInvoice.id, 4900).succeeded().withEventId("evt_4b").build()
    );

    assert.equal(res.body.resulting_status, "active");
    assertPersistedStatus(fixture, subId, "active");
  });

  it("past_due -> canceled: retries exhausted", async () => {
    const subId = await createProSubscription();

    const firstInvoice = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, firstInvoice.id, 4900).failed().withEventId("evt_5a").build());
    assertPersistedStatus(fixture, subId, "past_due");

    const retry1 = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, retry1.id, 4900).failed().withEventId("evt_5b").build());
    assertPersistedStatus(fixture, subId, "past_due"); // 1st retry failure: still past_due (MAX_RETRIES = 2)

    const retry2 = await fixture.service.attemptCharge(subId);
    const res = await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, retry2.id, 4900).failed().withEventId("evt_5c").build());

    assert.equal(res.body.resulting_status, "canceled");
    assertPersistedStatus(fixture, subId, "canceled");
  });

  it("active -> canceled: customer/API cancel", async () => {
    const subId = await createProSubscription();
    const invoice = await fixture.service.attemptCharge(subId);
    await fixture.api.postWebhook(WebhookPayloadBuilder.forInvoice(subId, invoice.id, 4900).succeeded().withEventId("evt_6").build());
    assertPersistedStatus(fixture, subId, "active");

    const res = await fixture.api.cancelSubscription(subId);

    assert.equal(res.body.status, "canceled");
    assertPersistedStatus(fixture, subId, "canceled");
  });

  it("trialing -> canceled: customer/API cancel", async () => {
    const subId = await createProSubscription();
    assertPersistedStatus(fixture, subId, "trialing");

    const res = await fixture.api.cancelSubscription(subId);

    assert.equal(res.body.status, "canceled");
    assertPersistedStatus(fixture, subId, "canceled");
  });
});
