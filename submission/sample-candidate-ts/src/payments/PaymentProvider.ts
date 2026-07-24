export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  reference: string; // invoice id, so a real provider could dedupe on its side too
}

export type ChargeOutcome = "succeeded" | "declined" | "timeout";

export interface ChargeResult {
  outcome: ChargeOutcome;
  providerChargeId?: string;
}

/**
 * Strategy/Adapter seam: production code depends on this interface only,
 * never on a concrete transport. Tests inject a mock/fake implementation
 * instead of talking to a real payment network.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
