import { APIRequestContext } from '@playwright/test';

export class SubscriptionApi {
  constructor(private readonly request: APIRequestContext) {}

  async getSubscriptions() {
    return this.request.get('/subscriptions');
  }

  async createSubscription(plan: string, userId: string) {
    return this.request.post('/subscriptions', {
      data: {
        userId,
        plan,
      },
    });
  }

  async cancelSubscription(subscriptionId: string) {
    return this.request.delete(`/subscriptions/${subscriptionId}`);
  }
}
