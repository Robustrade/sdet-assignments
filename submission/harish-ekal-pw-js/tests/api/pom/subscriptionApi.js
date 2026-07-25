const crypto = require('crypto');

class SubscriptionApi {
  constructor(request) {
    this.request = request;
  }

  createSubscription(body) {
    return this.request.post('/subscriptions', { data: body });
  }

  getSubscription(id) {
    return this.request.get(`/subscriptions/${id}`);
  }

  cancelSubscription(id) {
    return this.request.post(`/subscriptions/${id}/cancel`);
  }

  sendWebhook(payload, webhookSecret, overrides = {}) {
    const raw = overrides.rawBody || JSON.stringify(payload);
    const signature =
      overrides.signature ||
      crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');

    const headers = {
      'content-type': 'application/json',
      ...(overrides.omitSignature ? {} : { 'X-Provider-Signature': signature }),
    };

    const data = overrides.rawBody ? raw : payload;

    return this.request.post('/webhooks/payment-provider', { data, headers });
  }
}

module.exports = {
  SubscriptionApi,
};
