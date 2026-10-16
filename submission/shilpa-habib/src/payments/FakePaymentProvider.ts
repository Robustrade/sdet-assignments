import type { ChargeRequest, ChargeResult, PaymentProvider, PaymentOutcome, } from "./PaymentProvider";

export class FakePaymentProvider implements PaymentProvider { private nextOutcome: PaymentOutcome = "succeeded"; private calls: ChargeRequest[] = [];

setNextOutcome(outcome: PaymentOutcome): void { this.nextOutcome = outcome; }

async charge(request: ChargeRequest): Promise<ChargeResult> { this.calls.push({ ...request });

const outcome = this.nextOutcome;

if (outcome === "timeout") {
  throw new Error("Payment provider timed out");
}

return {
  outcome,
  providerReference:
    outcome === "succeeded"
      ? `pay_${this.calls.length}`
      : null,
  message: outcome === "declined" ? "Payment declined" : undefined,
};


}

getCalls(): ChargeRequest[] { return this.calls.map((call) => ({ ...call })); }

getCallCount(): number { return this.calls.length; }

reset(): void { this.calls = []; this.nextOutcome = "succeeded"; } }