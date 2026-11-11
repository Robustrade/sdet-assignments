
import { createHmac, timingSafeEqual } from 'crypto';

export class WebhookSignatureVerifier {
    constructor(private readonly secret: string) {
        if (!secret) {
            throw new Error('Webhook secret is required');
        }
    }

    verify(rawBody: Buffer, signature: string): boolean {
        if (!signature || !Buffer.isBuffer(rawBody)) {
            return false;
        }

        // Accept only a 64-character hexadecimal SHA-256 signature.
        if (!/^[a-fA-F0-9]{64}$/.test(signature)) {
            return false;
        }

        const expectedSignature = createHmac('sha256', this.secret)
            .update(rawBody)
            .digest();

        const receivedSignature = Buffer.from(signature, 'hex');

        return timingSafeEqual(expectedSignature, receivedSignature);
    }
}
