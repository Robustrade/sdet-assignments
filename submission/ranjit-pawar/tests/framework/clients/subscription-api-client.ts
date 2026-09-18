import type { HttpResponse, HttpTransport } from './http-transport';

export interface SubscriptionResource {
  id: string;
  customer_id: string;
  plan: string;
  state: 'trialing' | 'active' | 'past_due' | 'canceled';
  payment_method_id: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceResource {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'void';
  attempt: number;
  provider_charge_id: string | null;
  failure_code: string | null;
  paid_at: string | null;
  refunded_at: string | null;
}

export interface ApiError {
  error: { code: string; message: string; details: unknown };
}

/**
 * Typed client: transport details (paths, verbs, headers) live here so test
 * bodies read as domain intent. Returns the full response rather than throwing,
 * because error responses are themselves under test.
 */
export class SubscriptionApiClient {
  constructor(private readonly transport: HttpTransport) {}

  create(payload: unknown): Promise<HttpResponse<SubscriptionResource & ApiError>> {
    return this.transport.post('/subscriptions', { json: payload });
  }

  async createOrThrow(payload: unknown): Promise<SubscriptionResource> {
    const res = await this.create(payload);
    if (res.status !== 201) {
      throw new Error(`Expected 201 from POST /subscriptions, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  get(id: string): Promise<HttpResponse<SubscriptionResource & ApiError>> {
    return this.transport.get(`/subscriptions/${id}`);
  }

  cancel(id: string): Promise<HttpResponse<SubscriptionResource & ApiError>> {
    return this.transport.post(`/subscriptions/${id}/cancel`, { json: {} });
  }

  listInvoices(id: string): Promise<HttpResponse<{ data: InvoiceResource[] }>> {
    return this.transport.get(`/subscriptions/${id}/invoices`);
  }

  listEvents(id: string): Promise<HttpResponse<{ data: Array<Record<string, unknown>> }>> {
    return this.transport.get(`/subscriptions/${id}/events`);
  }

  runBillingCycle(): Promise<HttpResponse<{ ran_at: string; attempts: unknown[] }>> {
    return this.transport.post('/billing/run-cycle', { json: {} });
  }
}
