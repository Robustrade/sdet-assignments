const { expect } = require('@playwright/test');

/**
 * Typed wrapper around Playwright's APIRequestContext.
 * Tests call business-level methods; URLs and headers stay in here.
 */
class BillingApiClient {
  constructor(request) {
    this.request = request;
  }

  createSubscription(body) {
    return this.request.post('/subscriptions', { data: body });
  }

  // Raw bodies are sent as a Buffer: Playwright re-encodes a string that is not
  // valid JSON, which would change the bytes (and break the webhook signature).
  createSubscriptionWithRawBody(rawBody) {
    return this.request.post('/subscriptions', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from(rawBody),
    });
  }

  getSubscription(id) {
    return this.request.get(`/subscriptions/${id}`);
  }

  cancelSubscription(id) {
    return this.request.post(`/subscriptions/${id}/cancel`);
  }

  /** Sends a webhook built by WebhookBuilder ({ body, signature }). */
  sendWebhook({ body, signature }) {
    const headers = { 'Content-Type': 'application/json' };
    if (signature !== undefined) headers['X-Provider-Signature'] = signature;
    return this.request.post('/webhooks/payment-provider', { headers, data: Buffer.from(body) });
  }

  // Convenience methods for test setup: fail fast if setup itself breaks.

  async createSubscriptionOk(body) {
    const res = await this.createSubscription(body);
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }

  async sendWebhookOk(webhook) {
    const res = await this.sendWebhook(webhook);
    expect(res.status(), await res.text()).toBe(200);
    return res.json();
  }
}

module.exports = { BillingApiClient };
