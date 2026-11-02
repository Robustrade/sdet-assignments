export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  reference: string;
}

export type ChargeResult =
  | { outcome: "succeeded"; providerReference: string }
  | { outcome: "declined"; reason: string }
  | { outcome: "timeout" };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private readonly outcomes: ChargeResult[];

  constructor(outcomes: ChargeResult[] = []) {
    this.outcomes = [...outcomes];
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    return (
      this.outcomes.shift() ?? {
        outcome: "succeeded",
        providerReference: `mock_${request.reference}`,
      }
    );
  }
}
