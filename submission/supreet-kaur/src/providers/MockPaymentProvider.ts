import { ChargeAcceptance, ChargeRequest, PaymentProvider, ProviderDeclinedError, ProviderTimeoutError } from "./PaymentProvider";

export type MockOutcome = "accept" | "decline" | "timeout";

export interface RecordedCharge {
  readonly request: ChargeRequest;
  readonly outcome: MockOutcome;
  readonly at: Date;
}

/**
 * Test double for the payment provider. Two configuration levers, both intentionally simple:
 *
 *  - `setDefaultOutcome` sets the behaviour for every customer not otherwise configured.
 *  - `setOutcomeForCustomer` overrides the outcome for one customer_id, so a single test can
 *    have one subscription succeed and another decline without needing two providers.
 *
 * Every call is recorded in `calls` (full request + resolved outcome), which is what the
 * provider-interaction tests assert against: call count AND arguments, not just "was called".
 */
export class MockPaymentProvider implements PaymentProvider {
  private defaultOutcome: MockOutcome = "accept";
  private readonly perCustomerOutcome = new Map<string, MockOutcome>();
  readonly calls: RecordedCharge[] = [];
  private sequence = 0;

  setDefaultOutcome(outcome: MockOutcome): void {
    this.defaultOutcome = outcome;
  }

  setOutcomeForCustomer(customerId: string, outcome: MockOutcome): void {
    this.perCustomerOutcome.set(customerId, outcome);
  }

  get callCount(): number {
    return this.calls.length;
  }

  async charge(request: ChargeRequest): Promise<ChargeAcceptance> {
    const outcome = this.perCustomerOutcome.get(request.customerId) ?? this.defaultOutcome;
    this.calls.push({ request, outcome, at: new Date() });

    if (outcome === "decline") {
      throw new ProviderDeclinedError();
    }
    if (outcome === "timeout") {
      throw new ProviderTimeoutError();
    }

    this.sequence += 1;
    return { providerChargeId: `mock_ch_${this.sequence}_${request.idempotencyKey}` };
  }
}
