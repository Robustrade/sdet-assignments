export type ProviderOutcome = "success" | "decline" | "timeout";

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: "USD";
  idempotencyKey: string;
  invoiceId: string;
}

export interface ChargeResult {
  outcome: ProviderOutcome;
  providerReference: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): ChargeResult;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  outcome: ProviderOutcome = "success";

  charge(request: ChargeRequest): ChargeResult {
    this.calls.push(request);
    return {
      outcome: this.outcome,
      providerReference: `pay_${request.invoiceId}`
    };
  }
}
