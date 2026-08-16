import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from './BaseApiClient';
import { ApiEndpoints } from '../constants/ApiEndpoints';
import { Subscription } from '../models/Subscription';

export class SubscriptionApiClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request);
  }

  async createSubscription(subscription: Subscription): Promise<APIResponse> {
    return await this.post(ApiEndpoints.subscriptions, {
      data: subscription,
    });
  }

  async getSubscriptions(): Promise<APIResponse> {
    return await this.get(ApiEndpoints.subscriptions);
  }

  async getSubscription(subscriptionId: string): Promise<APIResponse> {
    return await this.get(`${ApiEndpoints.subscriptions}/${subscriptionId}`);
  }

  async updateSubscription(
    subscriptionId: string,
    subscription: Partial<Subscription>
  ): Promise<APIResponse> {
    return await this.put(`${ApiEndpoints.subscriptions}/${subscriptionId}`, {
      data: subscription,
    });
  }

  async cancelSubscription(subscriptionId: string): Promise<APIResponse> {
    return await this.patch(
      `${ApiEndpoints.subscriptions}/${subscriptionId}/cancel`
    );
  }

  async deleteSubscription(subscriptionId: string): Promise<APIResponse> {
    return await this.delete(`${ApiEndpoints.subscriptions}/${subscriptionId}`);
  }
}
