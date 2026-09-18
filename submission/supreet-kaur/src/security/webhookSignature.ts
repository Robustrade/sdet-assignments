import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs/verifies the raw webhook body with HMAC-SHA256, mirroring the `X-Provider-Signature`
 * header described in the assignment. Verification runs over the RAW bytes the provider sent
 * -- never the re-serialized JSON object -- because re-serialization can silently change key
 * order/whitespace and break a signature that was actually valid. The webhook route
 * (src/api/server.ts) is careful to hash the exact bytes it read off the socket before any
 * JSON.parse happens.
 */
export class WebhookSignature {
  constructor(private readonly secret: string) {}

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody, "utf8").digest("hex");
  }

  verify(rawBody: string, signatureHeader: string | undefined | null): boolean {
    if (!signatureHeader) return false;
    const expected = this.sign(rawBody);
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signatureHeader, "utf8");
    // timingSafeEqual throws if lengths differ, and requires equal-length buffers -- guard first.
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
