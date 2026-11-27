/**
 * The seam between the billing service and the external payment provider.
 * Production would put an HTTP adapter for the real provider behind this interface;
 * tests inject a scriptable double. The service never knows which one it has.
 */
export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  /** Same key => the provider must treat it as the same charge (no second debit). */
  idempotencyKey: string;
  /** Our invoice id, so provider-side records can be traced back. */
  invoiceId: string;
}

export type ChargeResult =
  | { outcome: 'succeeded'; providerChargeId: string }
  | { outcome: 'declined'; providerChargeId: string; reason: string };

/** The provider did not answer in time. Whether money moved is unknown. */
export class GatewayTimeoutError extends Error {
  constructor(message = 'Payment provider did not respond in time') {
    super(message);
    this.name = 'GatewayTimeoutError';
  }
}

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
