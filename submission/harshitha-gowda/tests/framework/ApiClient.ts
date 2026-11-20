export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

/** Typed HTTP client: transport details stay here, never in specs. */
export class ApiClient {
  constructor(private baseUrl: string, private onSubscriptionCreated: (id: string) => void = () => {}) {}

  async createSubscription(body: unknown): Promise<ApiResponse> {
    const res = await this.post('/subscriptions', JSON.stringify(body));
    if (res.status === 201) this.onSubscriptionCreated(res.body.id);
    return res;
  }

  getSubscription(id: string) {
    return this.request('GET', `/subscriptions/${id}`);
  }

  cancel(id: string) {
    return this.post(`/subscriptions/${id}/cancel`);
  }

  /** Stand-in for the scheduler: the trial ends and the first charge is attempted. */
  advanceTrial(id: string) {
    return this.post(`/admin/subscriptions/${id}/trial-end`);
  }

  /** Stand-in for the dunning scheduler: retry a past_due charge. */
  retryCharge(id: string) {
    return this.post(`/admin/subscriptions/${id}/retry`);
  }

  postWebhook(rawBody: string, headers: Record<string, string> = {}) {
    return this.post('/webhooks/payment-provider', rawBody, headers);
  }

  private post(path: string, body?: string, headers: Record<string, string> = {}) {
    return this.request('POST', path, body, headers);
  }

  private async request(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<ApiResponse> {
    const res = await fetch(this.baseUrl + path, { method, body, headers: { 'content-type': 'application/json', ...headers } });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}
