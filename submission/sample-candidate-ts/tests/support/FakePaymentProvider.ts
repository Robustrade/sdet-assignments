import { ChargeOutcome, ChargeRequest, ChargeResult, PaymentProvider } from "../../src/payments/PaymentProvider";

/**
 * Test double standing in for a real payment provider. Records every call
 * (arguments + count) so tests can assert exactly-once / correct-arguments
 * behavior, and lets each test configure the next outcome(s) without any
 * network dependency.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private queuedOutcomes: ChargeOutcome[] = [];
  private defaultOutcome: ChargeOutcome = "succeeded";

  get callCount(): number {
    return this.calls.length;
  }

  /** Sets the outcome for every charge that isn't covered by queueOutcome(). */
  setDefaultOutcome(outcome: ChargeOutcome): void {
    this.defaultOutcome = outcome;
  }

  /** Queues one-off outcomes, consumed in FIFO order before falling back to the default. */
  queueOutcome(outcome: ChargeOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);
    const outcome = this.queuedOutcomes.shift() ?? this.defaultOutcome;
    if (outcome === "timeout") {
      // A real provider timing out still leaves us not knowing whether the
      // charge happened. Treat it the same as a declined charge for the
      // subscription's state machine (fail safe: don't mark it active).
      return { outcome: "timeout" };
    }
    return {
      outcome,
      providerChargeId: outcome === "succeeded" ? `ch_${request.reference}` : undefined,
    };
  }
}
