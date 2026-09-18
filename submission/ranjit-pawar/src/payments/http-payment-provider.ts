import {
  PaymentProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider
} from './payment-provider';

/**
 * ADAPTER: translates the domain's PaymentProvider port into the imaginary
 * provider's HTTP dialect.
 *
 * It exists to show that the interface tests mock is a real production seam and
 * not an artefact invented for the test suite. It is never exercised by the
 * automated suite (no real network calls) — see docs/TEST_STRATEGY.md.
 */
export class HttpPaymentProvider implements PaymentProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 5_000
  ) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/charges`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Idempotency-Key': request.idempotencyKey
        },
        body: JSON.stringify({
          customer: request.customerId,
          payment_method: request.paymentMethodId,
          amount: request.amountCents,
          currency: request.currency,
          metadata: request.reference
        })
      });
      const payload = (await response.json()) as { id?: string; decline_code?: string };
      if (response.ok) {
        return { outcome: 'succeeded', chargeId: payload.id ?? 'unknown' };
      }
      return { outcome: 'declined', declineCode: payload.decline_code ?? 'card_declined' };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PaymentProviderTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
