import {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from "./payment-provider";

export type FakeProviderOutcome =
  | {
      type: "success";
      reference: string;
    }
  | {
      type: "decline";
      reference: string;
      failureReason: string;
    }
  | {
      type: "timeout";
    };

export class FakePaymentProvider implements PaymentProvider {
  private readonly requests: ChargeRequest[] = [];

  constructor(
    private readonly outcome: FakeProviderOutcome | ChargeResult = {
      success: true,
      reference: "pay_test",
    },
  ) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.requests.push(structuredClone(request));

    if ("type" in this.outcome && this.outcome.type === "timeout") {
      throw new Error("Payment provider timeout");
    }

    if ("type" in this.outcome && this.outcome.type === "decline") {
      return {
        success: false,
        reference: this.outcome.reference,
        failureReason: this.outcome.failureReason,
      };
    }

    if ("type" in this.outcome && this.outcome.type === "success") {
      return {
        success: true,
        reference: this.outcome.reference,
      };
    }

    return structuredClone(this.outcome as ChargeResult);
  }

  getChargeCount(): number {
    return this.requests.length;
  }

  getLastCharge(): ChargeRequest | undefined {
    return this.requests.at(-1);
  }

  getCharges(): ChargeRequest[] {
    return this.requests.map((request) => structuredClone(request));
  }
}
