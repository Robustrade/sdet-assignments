import { createHmac, timingSafeEqual } from 'node:crypto';

/** Seam so an alternative scheme (JWS, asymmetric) can be dropped in. */
export interface SignatureVerifier {
  sign(rawBody: string): string;
  verify(rawBody: string, signature: string | undefined): boolean;
}

export class HmacSignatureVerifier implements SignatureVerifier {
  constructor(private readonly secret: string) {}

  sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody, 'utf8').digest('hex');
  }

  verify(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(this.sign(rawBody), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
