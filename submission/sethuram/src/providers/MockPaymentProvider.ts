
import {
  PaymentProvider,
  ChargeRequest,
  ChargeResult
} from "./PaymentProvider";

export type PaymentOutcome =
  | "success"
  | "decline"
  | "timeout";

export class MockPaymentProvider implements PaymentProvider {
  public readonly calls: ChargeRequest[] = [];

  constructor(
    private outcome: PaymentOutcome = "success"
  ) {}

  setOutcome(outcome: PaymentOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });

    if (this.outcome === "timeout") {
      throw new Error("Payment provider timeout");
    }

    if (this.outcome === "decline") {
      return {
        transactionId: "txn_declined",
        status: "declined"
      };
    }

    return {
      transactionId: "txn_success",
      status: "succeeded"
    };
  }
}
