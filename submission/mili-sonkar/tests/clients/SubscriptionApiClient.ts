import type { Express } from 'express';
import request from 'supertest';
import type { Plan, Subscription } from '../../src/domain/Subscription.js';
import type { CreateSubscriptionResponse } from '../../src/application/SubscriptionService.js';

export interface CreateSubscriptionPayload {
    customerId: string;
    plan: Plan;
}

export interface ApiResponse<T> {
    status: number;
    body: T;
}

export class SubscriptionApiClient {
    constructor(private readonly app: Express) { }

    async createSubscription(
        payload: CreateSubscriptionPayload,
        options: { idempotencyKey?: string; correlationId?: string } = {},
    ): Promise<ApiResponse<CreateSubscriptionResponse>> {
        let requestBuilder = request(this.app)
            .post('/subscriptions')
            .send(payload);

        if (options.idempotencyKey) {
            requestBuilder = requestBuilder.set('Idempotency-Key', options.idempotencyKey);
        }

        if (options.correlationId) {
            requestBuilder = requestBuilder.set('X-Correlation-ID', options.correlationId);
        }

        const response = await requestBuilder;
        return { status: response.status, body: response.body as CreateSubscriptionResponse };
    }

    async getSubscription(id: string): Promise<ApiResponse<Subscription>> {
        const response = await request(this.app).get(`/subscriptions/${id}`);
        return { status: response.status, body: response.body as Subscription };
    }

    async cancelSubscription(
        id: string,
        correlationId?: string,
    ): Promise<ApiResponse<Subscription>> {
        let requestBuilder = request(this.app).post(`/subscriptions/${id}/cancel`);

        if (correlationId) {
            requestBuilder = requestBuilder.set('X-Correlation-ID', correlationId);
        }

        const response = await requestBuilder;
        return { status: response.status, body: response.body as Subscription };
    }
}
