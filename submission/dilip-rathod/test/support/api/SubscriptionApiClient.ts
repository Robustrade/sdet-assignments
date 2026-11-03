import { BillingRunContract, InvoiceListContract, SubscriptionContract } from './contracts';
import type { BillingRunDto, InvoiceDto, SubscriptionDto } from './contracts';
import type { ApiResponse, HttpClient } from './HttpClient';
import { expectStatus, parseContract } from './HttpClient';

/**
 * Typed client for the subscription API. Two flavours per operation:
 *   - `createSubscription(...)` returns the raw response, for tests about failures;
 *   - `create(...)` asserts the success status *and* the response contract, and returns a typed DTO.
 */
export class SubscriptionApiClient {
  constructor(private readonly http: HttpClient) {}

  createSubscription(body: unknown): Promise<ApiResponse> {
    return this.http.postJson('/subscriptions', body);
  }

  createSubscriptionRaw(raw: string): Promise<ApiResponse> {
    return this.http.postRaw('/subscriptions', raw);
  }

  getSubscription(id: string): Promise<ApiResponse> {
    return this.http.get(`/subscriptions/${encodeURIComponent(id)}`);
  }

  listInvoices(id: string): Promise<ApiResponse> {
    return this.http.get(`/subscriptions/${encodeURIComponent(id)}/invoices`);
  }

  cancelSubscription(id: string): Promise<ApiResponse> {
    return this.http.postJson(`/subscriptions/${encodeURIComponent(id)}/cancel`);
  }

  changePlanRequest(id: string, body: unknown): Promise<ApiResponse> {
    return this.http.postJson(`/subscriptions/${encodeURIComponent(id)}/plan`, body);
  }

  runBillingRequest(): Promise<ApiResponse> {
    return this.http.postJson('/internal/billing/run');
  }

  async create(body: unknown): Promise<SubscriptionDto> {
    return this.ok(await this.createSubscription(body), 201);
  }

  async get(id: string): Promise<SubscriptionDto> {
    return this.ok(await this.getSubscription(id), 200);
  }

  async invoices(id: string): Promise<InvoiceDto[]> {
    const res = await this.listInvoices(id);
    expectStatus(res, 200);
    return parseContract(InvoiceListContract, res, 'InvoiceList').data;
  }

  async cancel(id: string): Promise<SubscriptionDto> {
    return this.ok(await this.cancelSubscription(id), 200);
  }

  async changePlan(id: string, plan: string): Promise<SubscriptionDto> {
    return this.ok(await this.changePlanRequest(id, { plan }), 200);
  }

  async runBilling(): Promise<BillingRunDto['results']> {
    const res = await this.runBillingRequest();
    expectStatus(res, 200);
    return parseContract(BillingRunContract, res, 'BillingRun').results;
  }

  private ok(res: ApiResponse, status: number): SubscriptionDto {
    expectStatus(res, status);
    return parseContract(SubscriptionContract, res, 'Subscription');
  }
}
