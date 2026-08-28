export class SubscriptionApiClient {
  constructor(private readonly baseUrl: string) {}

  private buildUrl(path: string): string {
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    return new URL(path, `${normalizedBaseUrl}/`).toString();
  }

  async create(payload: unknown): Promise<unknown> {
    const response = await fetch(this.buildUrl('/subscriptions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error((data as { message?: string })?.message ?? `Request failed with status ${response.status}`);
    }

    return data;
  }

  async getById(id: string): Promise<unknown> {
    const response = await fetch(this.buildUrl(`/subscriptions/${encodeURIComponent(id)}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error((data as { message?: string })?.message ?? `Request failed with status ${response.status}`);
    }

    return data;
  }
}
