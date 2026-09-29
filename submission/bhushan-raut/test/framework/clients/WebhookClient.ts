import request from 'supertest';
type App = Parameters<typeof request>[0];
import type { WebhookDelivery } from '../doubles/WebhookSimulator';
import type { ApiResponse, ErrorBody, WebhookAck } from './contracts';

export const SIGNATURE_HEADER = 'X-Provider-Signature';

export class WebhookClient {
  constructor(private readonly app: App) {}

  async deliver(delivery: WebhookDelivery): Promise<ApiResponse<WebhookAck & Partial<ErrorBody>>> {
    let req = request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (delivery.signature !== undefined) req = req.set(SIGNATURE_HEADER, delivery.signature);
    const res = await req.send(delivery.rawBody);
    return { status: res.status, body: res.body };
  }
}
