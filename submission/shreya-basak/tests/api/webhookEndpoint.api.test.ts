import { createTestContext, TestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';


describe('Webhook endpoint request handling', () => {
  async function createTrialingSubscription(ctx: TestContext) {
    const res = await ctx.api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    return res.body;
  }

  it('accepts a validly signed, well-formed payload', async () => {
    const ctx = createTestContext();
    const sub = await createTrialingSubscription(ctx);
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(sub.id).buildSigned();

    const res = await ctx.api.postWebhook(rawBody, signature);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('rejects a payload with an invalid (non-matching) signature', async () => {
    const ctx = createTestContext();
    const sub = await createTrialingSubscription(ctx);
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(sub.id).buildWithInvalidSignature();

    const res = await ctx.api.postWebhook(rawBody, signature);

    expect(res.status).toBe(401);
  });

  it('rejects a payload with no signature header at all', async () => {
    const ctx = createTestContext();
    const sub = await createTrialingSubscription(ctx);
    const { rawBody } = new WebhookPayloadBuilder().ofType('payment.succeeded').forSubscription(sub.id).buildSigned();

    const res = await ctx.api.postWebhook(rawBody); // no signature argument

    expect(res.status).toBe(401);
  });

  it('rejects a validly signed but structurally malformed payload (missing "amount")', async () => {
    const ctx = createTestContext();
    const sub = await createTrialingSubscription(ctx);
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(sub.id).buildMalformedButSigned('amount');

    const res = await ctx.api.postWebhook(rawBody, signature);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('malformed_payload');
    expect(res.body.missing).toContain('amount');
  });

  it('rejects a validly signed but structurally malformed payload (missing "event_id")', async () => {
    const ctx = createTestContext();
    const sub = await createTrialingSubscription(ctx);
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(sub.id).buildMalformedButSigned('event_id');

    const res = await ctx.api.postWebhook(rawBody, signature);

    expect(res.status).toBe(400);
    expect(res.body.missing).toContain('event_id');
  });

  it('rejects a body that is not valid JSON at all with a consistent JSON error, not an HTML error page', async () => {
    const ctx = createTestContext();

    const res = await ctx.api.postWebhook('{ this is not valid json', 'irrelevant-signature-check-never-reached');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('malformed_json');
  });
});
