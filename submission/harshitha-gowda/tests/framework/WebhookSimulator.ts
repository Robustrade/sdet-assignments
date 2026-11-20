import { createHmac } from 'node:crypto';

export interface WebhookRequest {
  body: string;
  headers: Record<string, string>;
}

/** Builds the HTTP request the payment provider would send. Has its OWN HMAC, independent of the service code. */
export class WebhookSimulator {
  constructor(private secret: string) {}

  sign(raw: string, secret = this.secret): string {
    return createHmac('sha256', secret).update(raw).digest('hex');
  }

  signed(payload: object): WebhookRequest {
    const body = JSON.stringify(payload);
    return { body, headers: { 'X-Provider-Signature': this.sign(body) } };
  }

  unsigned(payload: object): WebhookRequest {
    return { body: JSON.stringify(payload), headers: {} };
  }

  forged(payload: object): WebhookRequest {
    const body = JSON.stringify(payload);
    return { body, headers: { 'X-Provider-Signature': this.sign(body, 'wrong-secret') } };
  }

  /** Signature is correct for the bytes sent, but the bytes are not valid JSON. */
  malformedJson(): WebhookRequest {
    const body = '{"event_id": "evt_x", "type": ';
    return { body, headers: { 'X-Provider-Signature': this.sign(body) } };
  }

  /** Tampered after signing: body no longer matches the signature. */
  tampered(payload: object): WebhookRequest {
    const original = JSON.stringify(payload);
    return { body: original.replace(/"amount":\d+/, '"amount":1'), headers: { 'X-Provider-Signature': this.sign(original) } };
  }
}
