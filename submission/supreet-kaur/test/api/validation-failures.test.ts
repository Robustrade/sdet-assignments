import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TestFixture } from "../support/TestFixture";
import { SubscriptionRequestBuilder } from "../support/builders/SubscriptionRequestBuilder";
import { CustomerBuilder } from "../support/builders/CustomerBuilder";

describe("Validation failures (Functional Expectation B)", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await TestFixture.start();
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("rejects an unknown plan with 400 and does not call the provider or persist a subscription", async () => {
    const res = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("enterprise-deluxe").build()
    );

    assert.equal(res.status, 400);
    assert.match(res.body.error, /unknown plan/i);
    assert.equal(fixture.paymentProvider.callCount, 0);
    assert.equal(fixture.subscriptions.all().length, 0);
  });

  it("rejects a missing customer_id with 400", async () => {
    const res = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withoutCustomer().build());
    assert.equal(res.status, 400);
    assert.equal(fixture.subscriptions.all().length, 0);
  });

  it("rejects an unknown customer_id with 400 and makes no provider call", async () => {
    const res = await fixture.api.createSubscription(
      new SubscriptionRequestBuilder().withCustomer(CustomerBuilder.unknown()).build()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unknown customer_id/i);
    assert.equal(fixture.paymentProvider.callCount, 0);
  });

  it("rejects a missing payment_method_id with 400", async () => {
    const res = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withoutPaymentMethod().build());
    assert.equal(res.status, 400);
    assert.equal(fixture.subscriptions.all().length, 0);
  });

  it("returns 404 for a subscription id that does not exist", async () => {
    const res = await fixture.api.getSubscription("sub_does_not_exist");
    assert.equal(res.status, 404);
  });

  it("rejects canceling an already-canceled subscription with 409 and leaves it canceled", async () => {
    const created = await fixture.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
    const firstCancel = await fixture.api.cancelSubscription(created.body.id);
    assert.equal(firstCancel.status, 200);
    assert.equal(firstCancel.body.status, "canceled");

    const secondCancel = await fixture.api.cancelSubscription(created.body.id);
    assert.equal(secondCancel.status, 409);

    const fetched = await fixture.api.getSubscription(created.body.id);
    assert.equal(fetched.body.status, "canceled", "double-cancel must not corrupt state");
  });
});
