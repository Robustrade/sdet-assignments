
import type { Express } from 'express';
import request from 'supertest';

import { WebhookSignature } from '../../src/webhooks/WebhookSignature.js';
import { WebhookBuilder } from '../builders/WebhookBuilder.js';

import type { PaymentWebhook } from '../../src/webhooks/WebhookTypes.js';

export class WebhookSimulator {
  private readonly endpoint = '/webhooks/payment-provider';

  constructor(
    private readonly app: Express,
    private readonly secret: string
  ) {}

  async send(
    webhook: PaymentWebhook
  ) {
    const rawBody = JSON.stringify(webhook);

    const signature = WebhookSignature.generate(
      rawBody,
      this.secret
    );

    return request(this.app)
      .post(this.endpoint)
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(rawBody);
  }

  async sendInvalidSignature(
    webhook: PaymentWebhook
  ) {
    const rawBody = JSON.stringify(webhook);

    return request(this.app)
      .post(this.endpoint)
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', 'invalid-signature')
      .send(rawBody);
  }

  async sendMalformedPayload(rawBody: string) {
    const signature = WebhookSignature.generate(
      rawBody,
      this.secret
    );

    return request(this.app)
      .post(this.endpoint)
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(rawBody);
  }

  async sendSuccessfulPayment(
    invoiceId: string,
    subscriptionId: string
  ) {
    const webhook = new WebhookBuilder()
      .withInvoiceId(invoiceId)
      .withSubscriptionId(subscriptionId)
      .asSucceeded()
      .build();

    return this.send(webhook);
  }

  async sendFailedPayment(
    invoiceId: string,
    subscriptionId: string,
    reason = 'Payment declined'
  ) {
    const webhook = new WebhookBuilder()
      .withInvoiceId(invoiceId)
      .withSubscriptionId(subscriptionId)
      .asFailed(reason)
      .build();

    return this.send(webhook);
  }
}
