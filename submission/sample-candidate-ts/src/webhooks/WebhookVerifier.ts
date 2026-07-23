import { createHmac, timingSafeEqual } from "crypto";

/** Verifies the `X-Provider-Signature` header on inbound webhook requests. */
export interface WebhookVerifier {
  verify(rawBody: string, signature: string | undefined): boolean;
}

export class HmacWebhookVerifier implements WebhookVerifier {
  constructor(private readonly secret: string) {}

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  verify(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(this.sign(rawBody), "hex");
    const provided = Buffer.from(signature, "hex");
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  }
}
