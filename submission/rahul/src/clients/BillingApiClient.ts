import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from './BaseApiClient';
import { ApiEndpoints } from '../constants/ApiEndpoints';
import { Billing } from '../models/Billing';

export class BillingApiClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request);
  }

  async createBilling(billing: Billing): Promise<APIResponse> {
    return await this.post(ApiEndpoints.billing, {
      data: billing,
    });
  }

  async getBillingRecords(): Promise<APIResponse> {
    return await this.get(ApiEndpoints.billing);
  }

  async getBillingRecord(billingId: string): Promise<APIResponse> {
    return await this.get(`${ApiEndpoints.billing}/${billingId}`);
  }

  async updateBilling(
    billingId: string,
    billing: Partial<Billing>
  ): Promise<APIResponse> {
    return await this.put(`${ApiEndpoints.billing}/${billingId}`, {
      data: billing,
    });
  }

  async deleteBilling(billingId: string): Promise<APIResponse> {
    return await this.delete(`${ApiEndpoints.billing}/${billingId}`);
  }
}
