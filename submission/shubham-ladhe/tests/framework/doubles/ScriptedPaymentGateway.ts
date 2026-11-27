import { Clock } from '../../../src/domain/time';
import { ChargeRequest, ChargeResult, GatewayTimeoutError, PaymentGateway } from '../../../src/payments/PaymentGateway';

type Step =
  | { kind: 'succeed' }
  | { kind: 'decline'; reason: string }
  /** `captured: true` = the provider took the money but the response was lost. */
  | { kind: 'timeout'; captured: boolean };

/**
 * Test double for the payment provider (outbound charges).
 *
 * - Outcomes are scripted per call (FIFO); when the script is empty, the fallback is used.
 * - Every call is recorded with its exact arguments for assertions.
 * - Behaves like a real provider on idempotency keys: a key that already produced a result
 *   returns that same result and does not move money again. This is what lets tests tell
 *   "the service called twice" apart from "the customer was charged twice".
 */
export class ScriptedPaymentGateway implements PaymentGateway {
  readonly calls: ChargeRequest[] = [];
  /** When each call in `calls` was made (same order), by the test clock. */
  readonly callTimes: string[] = [];
  private readonly script: Step[] = [];
  private fallback: Step = { kind: 'succeed' };
  private readonly ledger = new Map<string, ChargeResult>();
  private chargeSeq = 0;
  private readonly heldCalls: Array<{ reached: () => void; gate: Promise<void> }> = [];

  constructor(private readonly clock?: Clock) {}

  // ---- scripting ---------------------------------------------------------

  willSucceed(times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'succeed' });
    return this;
  }

  willDecline(reason = 'card_declined', times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'decline', reason });
    return this;
  }

  willTimeout(options: { captured?: boolean } = {}): this {
    this.script.push({ kind: 'timeout', captured: options.captured ?? false });
    return this;
  }

  alwaysDecline(reason = 'card_declined'): this {
    this.fallback = { kind: 'decline', reason };
    return this;
  }

  /**
   * Freeze the next charge call mid-flight (after the service has sent it, before the provider
   * answers). Lets a test do something else at exactly that moment, then `release()` it.
   * Deterministic - no sleeps or timing assumptions.
   */
  holdNextCall(): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    this.heldCalls.push({ reached, gate });
    return { reached: reachedPromise, release };
  }

  // ---- the PaymentGateway contract --------------------------------------

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    this.callTimes.push(this.clock?.now() ?? new Date().toISOString());
    const held = this.heldCalls.shift();
    if (held) {
      held.reached();
      await held.gate;
    }

    const previous = this.ledger.get(request.idempotencyKey);
    if (previous) return previous;

    const step = this.script.shift() ?? this.fallback;
    switch (step.kind) {
      case 'succeed':
        return this.remember(request.idempotencyKey, { outcome: 'succeeded', providerChargeId: this.nextChargeId() });
      case 'decline':
        return this.remember(request.idempotencyKey, {
          outcome: 'declined',
          providerChargeId: this.nextChargeId(),
          reason: step.reason,
        });
      case 'timeout':
        if (step.captured) {
          this.remember(request.idempotencyKey, { outcome: 'succeeded', providerChargeId: this.nextChargeId() });
        }
        throw new GatewayTimeoutError();
    }
  }

  // ---- assertion helpers -------------------------------------------------

  /** A position in the call log; pair with `callsSince(mark)` to see only what an action caused. */
  callCount(): number {
    return this.calls.length;
  }

  callsSince(mark: number): ChargeRequest[] {
    return this.calls.slice(mark);
  }

  callsForInvoice(invoiceId: string): ChargeRequest[] {
    return this.calls.filter((call) => call.invoiceId === invoiceId);
  }

  distinctIdempotencyKeys(): string[] {
    return [...new Set(this.calls.map((call) => call.idempotencyKey))];
  }

  /** Charges where money actually moved. */
  capturedCharges(): Array<{ idempotencyKey: string; providerChargeId: string }> {
    return [...this.ledger.entries()]
      .filter(([, result]) => result.outcome === 'succeeded')
      .map(([idempotencyKey, result]) => ({ idempotencyKey, providerChargeId: result.providerChargeId }));
  }

  resultFor(idempotencyKey: string): ChargeResult | undefined {
    return this.ledger.get(idempotencyKey);
  }

  private remember(key: string, result: ChargeResult): ChargeResult {
    this.ledger.set(key, result);
    return result;
  }

  private nextChargeId(): string {
    this.chargeSeq++;
    return `ch_${String(this.chargeSeq).padStart(4, '0')}`;
  }
}
