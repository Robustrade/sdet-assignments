import { vi } from 'vitest';
import type { ChargeRequest, ChargeResult, PaymentProvider } from '../../../src/payments/PaymentProvider';
import { ProviderTimeoutError } from '../../../src/payments/PaymentProvider';

export type ScriptedOutcome =
  | { kind: 'succeed' }
  | { kind: 'decline'; code: string }
  | { kind: 'pending' }
  | { kind: 'timeout' };

/** A charge the test is holding open, to interleave other events before the provider answers. */
export interface HeldCharge {
  /** Resolves with the request once the service has made the call. */
  readonly called: Promise<ChargeRequest>;
  respondWith(outcome: ScriptedOutcome): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type QueuedOutcome = ScriptedOutcome | { kind: 'hold'; called: Deferred<ChargeRequest>; release: Deferred<ScriptedOutcome> };

/**
 * Test double for the external payment provider. Outcomes are scripted per call (FIFO); when the
 * script is empty the fallback outcome (default: succeed) is used. Every request is recorded by
 * the underlying `vi.fn`, so tests can assert on call count and exact arguments.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly charge = vi.fn<(request: ChargeRequest) => Promise<ChargeResult>>((request) => this.respond(request));

  private readonly script: QueuedOutcome[] = [];
  private fallback: ScriptedOutcome = { kind: 'succeed' };
  private chargeSeq = 0;

  willSucceed(times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'succeed' });
    return this;
  }

  willDecline(code = 'card_declined', times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'decline', code });
    return this;
  }

  /** Provider accepts the charge; the outcome is delivered later by webhook. */
  willReturnPending(): this {
    this.script.push({ kind: 'pending' });
    return this;
  }

  willTimeout(): this {
    this.script.push({ kind: 'timeout' });
    return this;
  }

  alwaysRespond(outcome: ScriptedOutcome): this {
    this.fallback = outcome;
    return this;
  }

  holdNextCharge(): HeldCharge {
    const entry = { kind: 'hold' as const, called: deferred<ChargeRequest>(), release: deferred<ScriptedOutcome>() };
    this.script.push(entry);
    return { called: entry.called.promise, respondWith: (outcome) => entry.release.resolve(outcome) };
  }

  get requests(): ChargeRequest[] {
    return this.charge.mock.calls.map(([request]) => request);
  }

  get lastRequest(): ChargeRequest | undefined {
    return this.requests.at(-1);
  }

  get callCount(): number {
    return this.charge.mock.calls.length;
  }

  private async respond(request: ChargeRequest): Promise<ChargeResult> {
    const chargeId = `ch_mock_${++this.chargeSeq}`;
    let next = this.script.shift() ?? this.fallback;
    if (next.kind === 'hold') {
      next.called.resolve(request);
      next = await next.release.promise;
    }
    switch (next.kind) {
      case 'succeed':
        return { status: 'succeeded', chargeId };
      case 'decline':
        return { status: 'declined', chargeId, declineCode: next.code };
      case 'pending':
        return { status: 'pending', chargeId };
      case 'timeout':
        throw new ProviderTimeoutError();
    }
  }
}
