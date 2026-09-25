import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from "./payment-provider.js";

export type MockPaymentOutcome =
  | "success"
  | "decline"
  | "timeout";

export class MockPaymentProvider implements PaymentProvider {
  private readonly calls: ChargeRequest[] = [];

  constructor(
    private outcome: MockPaymentOutcome = "success",
  ) {}

  setOutcome(outcome: MockPaymentOutcome): void {
    this.outcome = outcome;
  }

  getCalls(): readonly ChargeRequest[] {
    return [...this.calls];
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);

    if (this.outcome === "timeout") {
      throw new Error("PAYMENT_PROVIDER_TIMEOUT");
    }

    if (this.outcome === "decline") {
      return {
        success: false,
        providerReference: `ref_${request.idempotencyKey}`,
        failureCode: "card_declined",
        failureMessage: "Payment was declined",
      };
    }

    return {
      success: true,
      providerReference: `ref_${request.idempotencyKey}`,
    };
  }
}