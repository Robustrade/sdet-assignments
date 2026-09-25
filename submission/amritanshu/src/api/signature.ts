import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export function generateSignature(
  rawBody: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
}

export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }

  const expectedSignature = generateSignature(
    rawBody,
    secret,
  );

  const received = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}