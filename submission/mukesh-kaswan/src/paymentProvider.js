/**
 * Payment provider contract (the seam between our service and the outside world).
 *
 * Any object with this method can be injected into BillingService:
 *
 *   charge({ customer_id, payment_method_id, amount, currency, idempotency_key })
 *     -> Promise<{ status: 'succeeded' | 'declined', charge_id, decline_code? }>
 *     -> rejects with PaymentProviderTimeoutError when the provider does not answer
 *
 * Production would inject an HTTP client; tests inject FakePaymentProvider.
 */
class PaymentProviderTimeoutError extends Error {
  constructor() {
    super('Payment provider timed out');
  }
}

module.exports = { PaymentProviderTimeoutError };
