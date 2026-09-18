import { WebhookSignature } from "../../src/security/webhookSignature";

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface CreateSubscriptionBody {
  customer_id?: unknown;
  plan?: unknown;
  payment_method_id?: unknown;
}

/**
 * API Client Layer (required by the assignment's "Architecture Expectations"): every test
 * scenario talks to the service through this class, never through raw `fetch` calls scattered
 * around test files. If the transport changes (e.g. adding auth headers everywhere), one file
 * changes.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly signature: WebhookSignature) {}

  async createSubscription(body: CreateSubscriptionBody): Promise<ApiResponse> {
    return this.request("POST", "/subscriptions", JSON.stringify(body));
  }

  async getSubscription(id: string): Promise<ApiResponse> {
    return this.request("GET", `/subscriptions/${encodeURIComponent(id)}`);
  }

  async cancelSubscription(id: string): Promise<ApiResponse> {
    return this.request("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`);
  }

  /** Posts a webhook payload, signing it correctly by default. Pass rawBodyOverride/signatureOverride to test bad signatures or malformed bodies. */
  async postWebhook(payload: unknown, opts?: { rawBodyOverride?: string; signatureOverride?: string | null }): Promise<ApiResponse> {
    const rawBody = opts?.rawBodyOverride ?? JSON.stringify(payload);
    const signatureHeader = opts?.signatureOverride !== undefined ? opts.signatureOverride : this.signature.sign(rawBody);
    return this.request("POST", "/webhooks/payment-provider", rawBody, signatureHeader);
  }

  private async request(method: string, path: string, rawBody?: string, providerSignature?: string | null): Promise<ApiResponse> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (providerSignature !== undefined && providerSignature !== null) {
      headers["X-Provider-Signature"] = providerSignature;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: rawBody,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text.length ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }
}
