import {
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

export function createWebhookSignature(
    rawBody: Buffer,
    secret: string,
): string {
    return createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
}

export function verifyWebhookSignature(
    rawBody: Buffer,
    signature: string,
    secret: string,
): boolean {
    const provided = signature.startsWith('sha256=')
        ? signature.slice('sha256='.length)
        : signature;

    const expected = createWebhookSignature(
        rawBody,
        secret,
    );

    const providedBuffer = Buffer.from(
        provided,
        'utf8',
    );

    const expectedBuffer = Buffer.from(
        expected,
        'utf8',
    );

    if (
        providedBuffer.length !==
        expectedBuffer.length
    ) {
        return false;
    }

    return timingSafeEqual(
        providedBuffer,
        expectedBuffer,
    );
}