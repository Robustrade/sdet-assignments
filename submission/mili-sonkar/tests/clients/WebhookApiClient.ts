import type { Express } from 'express';
import request from 'supertest';
import { createWebhookSignature } from '../../src/shared/webhookSignature.js';
import type { WebhookEventType } from '../../src/application/WebhookProcessor.js';

export interface WebhookRequest {
    event_id: string;
    event_type: WebhookEventType;
    subscription_id: string;
}

export class WebhookApiClient {
    constructor(
        private readonly app: Express,
        private readonly secret: string,
    ) { }

    async send(
        payload: WebhookRequest,
        correlationId?: string,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
        const body = JSON.stringify(payload);
        let requestBuilder = request(this.app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'text/plain')
            .set('X-Webhook-Signature', createWebhookSignature(Buffer.from(body), this.secret))
            .send(body);

        if (correlationId) {
            requestBuilder = requestBuilder.set('X-Correlation-ID', correlationId);
        }

        const response = await requestBuilder;
        return { status: response.status, body: response.body as Record<string, unknown> };
    }
}
