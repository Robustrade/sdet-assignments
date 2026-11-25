
import { createHmac, timingSafeEqual } from "crypto";

export class WebhookSignature {
  constructor(private readonly secret: string) {
    if (!secret) {
      throw new Error("Webhook secret is required");
    }
  }

  sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(payload)
      .digest("hex");
  }

  verify(payload: string, signature: string): boolean {
    if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature)) {
      return false;
    }

    const expected = Buffer.from(
      this.sign(payload),
      "hex"
    );

    const received = Buffer.from(
      signature,
      "hex"
    );

    return timingSafeEqual(expected, received);
  }
}
