import {
  PaymentProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider
} from "../../src/domain/payment-provider";

export type PaymentOutcome =
  | {
      type: "success";
      providerReference?: string;
    }
  | {
      type: "declined";
      failureCode?: string;
      providerReference?: string;
    }
  | {
      type: "timeout";
    };

export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];

  private queuedOutcomes: PaymentOutcome[] = [];

  queueOutcome(outcome: PaymentOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  get callCount(): number {
    return this.calls.length;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });

    const outcome: PaymentOutcome =
      this.queuedOutcomes.shift() ?? { type: "success" };

    const reference =
      outcome.type === "timeout"
        ? undefined
        : outcome.providerReference ?? `fake_charge_${this.calls.length}`;

    switch (outcome.type) {
      case "success":
        return {
          outcome: "succeeded",
          providerReference: reference!
        };

      case "declined":
        return {
          outcome: "declined",
          providerReference: reference!,
          failureCode: outcome.failureCode ?? "card_declined"
        };

      case "timeout":
        throw new PaymentProviderTimeoutError();
    }
  }
}