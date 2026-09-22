import crypto from 'crypto';

export function generateWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  secret: string,
): boolean {
  const expected =
    generateWebhookSignature(rawBody, secret);

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    signatureBuffer,
  );
}
