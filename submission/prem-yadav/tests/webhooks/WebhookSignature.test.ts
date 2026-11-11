
import { createHmac } from 'crypto';
import { WebhookSignatureVerifier } from '../../src/utils/WebhookSignature';

describe('WebhookSignatureVerifier', () => {
    const secret = 'test-webhook-secret';
    const rawBody = Buffer.from(
        JSON.stringify({ event_id: 'evt-001', type: 'payment.succeeded' })
    );

    let verifier: WebhookSignatureVerifier;

    beforeEach(() => {
        verifier = new WebhookSignatureVerifier(secret);
    });

    function generateSignature(body: Buffer): string {
        return createHmac('sha256', secret)
            .update(body)
            .digest('hex');
    }

    it('should accept a valid signature', () => {
        const signature = generateSignature(rawBody);

        expect(verifier.verify(rawBody, signature)).toBe(true);
    });

    it('should reject a modified request body', () => {
        const signature = generateSignature(rawBody);
        const modifiedBody = Buffer.from(
            JSON.stringify({ event_id: 'evt-002', type: 'payment.succeeded' })
        );

        expect(verifier.verify(modifiedBody, signature)).toBe(false);
    });

    it('should reject an invalid signature', () => {
        expect(verifier.verify(rawBody, 'invalid-signature')).toBe(false);
    });

    it('should reject a missing signature', () => {
        expect(verifier.verify(rawBody, '')).toBe(false);
    });

    it('should reject a signature generated with another secret', () => {
        const signature = createHmac('sha256', 'wrong-secret')
            .update(rawBody)
            .digest('hex');

        expect(verifier.verify(rawBody, signature)).toBe(false);
    });
});
