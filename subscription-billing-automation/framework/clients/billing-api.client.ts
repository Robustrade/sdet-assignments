import { createHmac } from 'node:crypto';
import { ApiResponse, CreateSubscriptionRequest, SubscriptionBillingService } from '../../src/service/subscription-billing.service';
import { WebhookPayload } from '../../src/domain/models/webhook-event.model';

export class BillingApiClient {
  constructor(private readonly service: SubscriptionBillingService) {}

  request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    return this.service.dispatch(method, path, body);
  }

  createSubscription(request: CreateSubscriptionRequest): Promise<ApiResponse> {
    return this.service.dispatch('POST', '/subscriptions', request);
  }

  getSubscription(subscriptionId: string): Promise<ApiResponse> {
    return this.service.dispatch('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  cancelSubscription(subscriptionId: string): Promise<ApiResponse> {
    return this.service.dispatch('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`);
  }

  postWebhook(payload: WebhookPayload): Promise<ApiResponse> {
    const rawBody = JSON.stringify(payload);
    return this.postRawWebhook(rawBody, this.sign(rawBody));
  }

  postRawWebhook(rawBody: string, signature?: string): Promise<ApiResponse> {
    return this.service.dispatch(
      'POST',
      '/webhooks/payment-provider',
      undefined,
      signature ? { 'x-provider-signature': signature } : {},
      rawBody,
    );
  }

  sign(rawBody: string): string {
    return createHmac('sha256', this.service.webhookSecret).update(rawBody).digest('hex');
  }
}
