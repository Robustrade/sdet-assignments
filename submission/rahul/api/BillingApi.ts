import { APIRequestContext } from '@playwright/test';

export class BillingApi {
  constructor(private readonly request: APIRequestContext) {}

  async getInvoices(userId: string) {
    return this.request.get(`/billing/invoices/${userId}`);
  }

  async makePayment(userId: string, amount: number) {
    return this.request.post('/billing/payments', {
      data: {
        userId,
        amount,
      },
    });
  }
}
