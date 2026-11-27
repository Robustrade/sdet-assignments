/**
 * Scriptable and call-recording test double for BillingGateway.
 * Author: Vedant Dalkari
 */

import type {
  BillingGateway,
  ChargeRequest,
  ChargeResult,
} from '../../../src/ports/BillingGateway.js';

export interface RecordedChargeCall extends ChargeRequest {
  readonly sequence: number;
}

type ScriptedEntry =
  | { readonly kind: 'result'; readonly value: ChargeResult }
  | { readonly kind: 'reject'; readonly error: Error };

export class RecordingBillingGateway implements BillingGateway {
  private readonly recordedCalls: RecordedChargeCall[] = [];
  private readonly queue: ScriptedEntry[] = [];
  private callCheckpoint = 0;
  private defaultOutcome: ChargeResult = {
    status: 'approved',
    providerReference: 'ch_default_001',
  };
  private referenceCounter = 0;

  public get calls(): readonly RecordedChargeCall[] {
    return this.recordedCalls.slice(this.callCheckpoint);
  }

  public get lifetimeCalls(): readonly RecordedChargeCall[] {
    return [...this.recordedCalls];
  }

  public callCount(): number {
    return this.recordedCalls.length - this.callCheckpoint;
  }

  public lifetimeCallCount(): number {
    return this.recordedCalls.length;
  }

  public lastCall(): RecordedChargeCall | undefined {
    return this.calls.at(-1);
  }

  public alwaysApprove(providerReference?: string): this {
    this.defaultOutcome = {
      status: 'approved',
      providerReference: providerReference ?? 'ch_default_approved',
    };
    return this;
  }

  public alwaysDecline(reason: string = 'card_declined'): this {
    this.defaultOutcome = { status: 'declined', reason };
    return this;
  }

  public alwaysTimeout(reason: string = 'gateway_timeout_504'): this {
    this.defaultOutcome = { status: 'timeout', reason };
    return this;
  }

  public approveNext(providerReference?: string): this {
    this.referenceCounter += 1;
    this.queue.push({
      kind: 'result',
      value: {
        status: 'approved',
        providerReference: providerReference ?? `ch_ref_${String(this.referenceCounter).padStart(3, '0')}`,
      },
    });
    return this;
  }

  public declineNext(reason: string = 'card_declined'): this {
    this.queue.push({
      kind: 'result',
      value: { status: 'declined', reason },
    });
    return this;
  }

  public timeoutNext(reason: string = 'gateway_timeout_504'): this {
    this.queue.push({
      kind: 'result',
      value: { status: 'timeout', reason },
    });
    return this;
  }

  public rejectNext(error: Error): this {
    this.queue.push({ kind: 'reject', error });
    return this;
  }

  public scriptOutcomes(...outcomes: ChargeResult[]): this {
    for (const outcome of outcomes) {
      this.queue.push({ kind: 'result', value: outcome });
    }
    return this;
  }

  public resetCalls(): void {
    this.callCheckpoint = this.recordedCalls.length;
  }

  public reset(): void {
    this.recordedCalls.length = 0;
    this.callCheckpoint = 0;
    this.queue.length = 0;
    this.referenceCounter = 0;
    this.alwaysApprove();
  }

  public async charge(request: ChargeRequest): Promise<ChargeResult> {
    await Promise.resolve();
    const entry: RecordedChargeCall = {
      ...request,
      sequence: this.recordedCalls.length + 1,
    };
    this.recordedCalls.push(entry);

    const next = this.queue.shift();
    if (!next) {
      return this.defaultOutcome;
    }
    if (next.kind === 'reject') {
      throw next.error;
    }
    return next.value;
  }
}
