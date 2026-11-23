import { beforeEach, describe, expect, it } from "vitest";
import { TestFixture } from "../src/testFixture";
import { SubscriptionBuilder, WebhookBuilder } from "../src/builders";
import type { Subscription } from "../src/domain";

describe("Subscription & Billing Service", () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = new TestFixture();
  });

  it("creates a pro trial subscription and exposes persisted agreement", async () => {
    const body = new SubscriptionBuilder().withPlan("pro").build();
    const created = await fixture.api.create(body);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      customerId: "cust_001",
      plan: "pro",
      status: "trialing"
    });
    expect(fixture.service.repository.subscriptions.get(created.body.id)?.status).toBe("trialing");
  });

  it("rejects invalid plans and missing fields without provider calls", async () => {
    const invalidPlan = await fixture.api.create(
      new SubscriptionBuilder().withPlan("free" as "basic").build()
    );
    expect(invalidPlan.status).toBe(400);

    const missingCustomer = await fixture.api.create({
      plan: "basic",
      payment_method_id: "pm_test"
    });
    expect(missingCustomer.status).toBe(400);
    expect(fixture.service.repository.subscriptions.size).toBe(0);
    expect(fixture.provider.calls).toHaveLength(0);

    const unknownCustomer = await fixture.api.create(
      new SubscriptionBuilder().forCustomer("cust_unknown").build()
    );
    expect(unknownCustomer.status).toBe(400);
    expect(fixture.provider.calls).toHaveLength(0);
  });

  it("retrieves subscriptions and rejects canceling an unknown or canceled subscription", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    expect((await fixture.api.get(id)).status).toBe(200);

    expect((await fixture.api.cancel(id)).status).toBe(200);
    expect((await fixture.api.cancel(id)).status).toBe(409);
    expect((await fixture.api.cancel("sub_missing")).status).toBe(404);
  });

  it("uses correct plan price and provider arguments for a real charge", () => {
    const created: Subscription = { id: "sub_1", customerId: "cust_001", plan: "pro", paymentMethodId: "pm_test", status: "trialing", retryCount: 0, createdAt: "", updatedAt: "" };
    fixture.service.repository.subscriptions.set(created.id, created);

    fixture.service.bill(created.id, "inv_1");

    expect(fixture.provider.calls).toHaveLength(1);
    expect(fixture.provider.calls[0]).toMatchObject({
      customerId: "cust_001",
      paymentMethodId: "pm_test",
      amount: 4900,
      currency: "USD",
      idempotencyKey: "invoice_inv_1"
    });
  });

  it("moves trialing to past_due on a failed webhook and persists the failed invoice", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    const payload = new WebhookBuilder(id, "inv_fail").failed().build();

    const response = await fixture.api.webhook(payload);
    expect(response.status).toBe(200);
    expect((await fixture.api.get(id)).body.status).toBe("past_due");
    expect(fixture.service.repository.invoices.get("inv_fail")).toMatchObject({
      subscriptionId: id,
      status: "failed"
    });
  });

  it("moves trialing to active on success and past_due to active on retry success", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;

    await fixture.api.webhook(new WebhookBuilder(id, "inv_success").succeeded().build());
    expect((await fixture.api.get(id)).body.status).toBe("active");

    await fixture.api.webhook(new WebhookBuilder(id, "inv_fail").failed().build());
    expect((await fixture.api.get(id)).body.status).toBe("past_due");

    await fixture.api.webhook(new WebhookBuilder(id, "inv_retry").succeeded().build());
    expect((await fixture.api.get(id)).body.status).toBe("active");
  });

  it("cancels after retry failures are exhausted", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    await fixture.api.webhook(new WebhookBuilder(id, "inv_1").failed().build());
    await fixture.api.webhook(new WebhookBuilder(id, "inv_2").failed().build());
    await fixture.api.webhook(new WebhookBuilder(id, "inv_3").failed().build());
    expect((await fixture.api.get(id)).body.status).toBe("canceled");
  });

  it("handles duplicate delivery once and does not duplicate persisted side effects", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    const payload = new WebhookBuilder(id, "inv_duplicate").withEventId("evt_duplicate").succeeded().build();

    const first = await fixture.api.webhook(payload);
    const second = await fixture.api.webhook(payload);

    expect(first.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(fixture.service.repository.invoices.size).toBe(1);
    expect(fixture.service.repository.webhookEvents.size).toBe(1);
    expect(fixture.service.repository.audit.filter(a => a.subscriptionId === id).length).toBe(2);
  });

  it("rejects forged signatures and malformed payloads", async () => {
    const forged = await fixture.api.webhook(
      new WebhookBuilder("sub_missing", "inv_1").build(),
      { signed: true, signature: "forged" }
    );
    expect(forged.status).toBe(401);

    const malformed = await fixture.api.webhook({ event_id: "evt_bad" } as Record<string, unknown>);
    expect(malformed.status).toBe(400);
  });

  it("does not allow canceled or stale succeeded-to-failed transitions", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    await fixture.api.webhook(new WebhookBuilder(id, "inv_ok").succeeded().build());

    const failed = await fixture.api.webhook(new WebhookBuilder(id, "inv_ok").withEventId("evt_late_fail").failed().build());
    expect(failed.status).toBe(200);
    expect((await fixture.api.get(id)).body.status).toBe("active");
    expect(fixture.service.repository.invoices.get("inv_ok")?.status).toBe("succeeded");

    await fixture.api.cancel(id);
    await fixture.api.webhook(new WebhookBuilder(id, "inv_late").withEventId("evt_after_cancel").failed().build());
    expect((await fixture.api.get(id)).body.status).toBe("canceled");
  });

  it("returns valid and invalid provider outcomes without charging on replay", () => {
    fixture.provider.outcome = "decline";
    const created: Subscription = { id: "sub_decline", customerId: "cust_1", plan: "basic", paymentMethodId: "pm_1", status: "trialing", retryCount: 0, createdAt: "", updatedAt: "" };
    fixture.service.repository.subscriptions.set(created.id, created);

    expect(fixture.service.bill(created.id, "inv_decline").outcome).toBe("decline");
    fixture.provider.outcome = "timeout";
    expect(fixture.service.bill(created.id, "inv_timeout").outcome).toBe("timeout");
    expect(fixture.provider.calls).toHaveLength(2);
  });

  it("does not reactivate a canceled subscription via any webhook", async () => {
    const created = await fixture.api.create(new SubscriptionBuilder().build());
    const id = created.body.id;
    await fixture.api.cancel(id);

    await fixture.api.webhook(new WebhookBuilder(id, "inv_cancelled").succeeded().build());
    const subscription = fixture.service.repository.subscriptions.get(id);
    expect(subscription?.status).toBe("canceled");
  });
});
