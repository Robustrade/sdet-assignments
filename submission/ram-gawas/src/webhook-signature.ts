import crypto from 'crypto';

export function generateWebhookSignature(
  payload: unknown,
  secret: string,
): string {
  const body = JSON.stringify(payload);

  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

export function verifyWebhookSignature(
  payload: unknown,
  signature: string,
  secret: string,
): boolean {
  const expected =
    generateWebhookSignature(payload, secret);

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