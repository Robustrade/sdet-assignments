import type { SignatureVerifier } from '../../../src/services/signature-verifier';
import type { HttpResponse, HttpTransport } from './http-transport';

export interface WebhookErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface WebhookResult {
  status: 'processed' | 'duplicate' | 'ignored';
  event_id: string;
  subscription_id: string;
  subscription_state: string;
  reason?: string;
}

export type SignatureMode = 'valid' | 'invalid' | 'missing' | 'tampered';

export interface DeliveryOptions {
  signature?: SignatureMode;
  /** Send these exact bytes (for malformed-payload tests). */
  rawBody?: string;
}

/**
 * WEBHOOK SIMULATOR. Owns everything about inbound provider delivery: canonical
 * serialization, HMAC signing, and the deliberate corruptions (bad signature,
 * missing header, tampered body, malformed JSON) the endpoint must reject.
 */
export class WebhookApiClient {
  static readonly PATH = '/webhooks/payment-provider';

  constructor(
    private readonly transport: HttpTransport,
    private readonly signatures: SignatureVerifier
  ) {}

  deliver(
    payload: unknown,
    options: DeliveryOptions = {}
  ): Promise<HttpResponse<WebhookResult & WebhookErrorBody>> {
    const body = options.rawBody ?? JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    switch (options.signature ?? 'valid') {
      case 'valid':
        headers['X-Provider-Signature'] = this.signatures.sign(body);
        break;
      case 'invalid':
        headers['X-Provider-Signature'] = 'f'.repeat(64);
        break;
      case 'tampered':
        // Correctly signed, but for a different body than the one we send.
        headers['X-Provider-Signature'] = this.signatures.sign(`${body} `);
        break;
      case 'missing':
        break;
    }

    return this.transport.post(WebhookApiClient.PATH, { headers, rawBody: body });
  }

  /** Deliver the same event N times, as a flaky provider would. */
  async deliverTimes(payload: unknown, times: number): Promise<HttpResponse<WebhookResult>[]> {
    const results: HttpResponse<WebhookResult>[] = [];
    for (let i = 0; i < times; i++) results.push(await this.deliver(payload));
    return results;
  }

  /** Bonus: racing redelivery. */
  deliverConcurrently(payload: unknown, times: number): Promise<HttpResponse<WebhookResult>[]> {
    return Promise.all(Array.from({ length: times }, () => this.deliver(payload)));
  }
}
