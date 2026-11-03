import { createHmac } from 'node:crypto';
import { WebhookAckContract } from '../api/contracts';
import type { WebhookAckDto } from '../api/contracts';
import type { ApiResponse, HttpClient } from '../api/HttpClient';
import { expectStatus, parseContract } from '../api/HttpClient';
import type { WebhookEventBuilder } from '../builders/builders';

const PATH = '/webhooks/payment-provider';
const HEADER = 'X-Provider-Signature';

type EventInput = WebhookEventBuilder | Record<string, unknown>;

const toRaw = (event: EventInput) => JSON.stringify('build' in event && typeof event.build === 'function' ? event.build() : event);

/**
 * Plays the payment provider's side of the webhook contract. Signs with its own HMAC
 * implementation (not the service's verifier) so a verifier bug cannot hide behind shared code.
 */
export class WebhookSimulator {
  constructor(
    private readonly http: HttpClient,
    private readonly secret: string,
  ) {}

  sign(raw: string, secret = this.secret): string {
    return createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  }

  /** Correctly signed delivery. */
  deliver(event: EventInput): Promise<ApiResponse> {
    const raw = toRaw(event);
    return this.http.postRaw(PATH, raw, { [HEADER]: this.sign(raw) });
  }

  /** Correctly signed delivery that must be accepted (200 + ack contract). */
  async deliverOk(event: EventInput): Promise<WebhookAckDto> {
    const res = await this.deliver(event);
    expectStatus(res, 200);
    return parseContract(WebhookAckContract, res, 'WebhookAck');
  }

  deliverUnsigned(event: EventInput): Promise<ApiResponse> {
    return this.http.postRaw(PATH, toRaw(event));
  }

  deliverWithSignature(event: EventInput, signature: string): Promise<ApiResponse> {
    return this.http.postRaw(PATH, toRaw(event), { [HEADER]: signature });
  }

  deliverSignedWithSecret(event: EventInput, secret: string): Promise<ApiResponse> {
    const raw = toRaw(event);
    return this.http.postRaw(PATH, raw, { [HEADER]: this.sign(raw, secret) });
  }

  /** Signs the original body, then sends a modified one — a man-in-the-middle edit. */
  deliverTampered(original: EventInput, tampered: EventInput): Promise<ApiResponse> {
    return this.http.postRaw(PATH, toRaw(tampered), { [HEADER]: this.sign(toRaw(original)) });
  }

  deliverRaw(raw: string, options: { signed: boolean }): Promise<ApiResponse> {
    return this.http.postRaw(PATH, raw, options.signed ? { [HEADER]: this.sign(raw) } : {});
  }
}
