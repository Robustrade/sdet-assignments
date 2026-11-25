
import {
  createHmac,
  timingSafeEqual
} from 'node:crypto';

export class WebhookSignature {
  static generate(
    rawBody: string,
    secret: string
  ): string {
    return createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
  }

  static verify(
    rawBody: string,
    signature: string,
    secret: string
  ): boolean {
    if (!rawBody || !signature || !secret) {
      return false;
    }

    const normalizedSignature = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    if (!/^[a-fA-F0-9]{64}$/.test(normalizedSignature)) {
      return false;
    }

    const expectedSignature = this.generate(rawBody, secret);

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(
      normalizedSignature,
      'hex'
    );

    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }
}
