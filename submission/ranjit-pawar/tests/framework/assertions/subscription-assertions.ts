import { expect } from 'vitest';
import type { SubscriptionState } from '../../../src/domain/types';
import type { InvoiceStatus } from '../../../src/persistence/records';
import type { TestEnvironment } from '../harness/test-environment';

/**
 * VERIFICATION LAYER.
 *
 * Tests never query the store directly: every persisted assertion goes through
 * a repository here, and every state assertion checks the API answer and the
 * persisted row together, so the two can never silently diverge.
 */
export class SubscriptionAssertions {
  private constructor(
    private readonly env: TestEnvironment,
    private readonly id: string
  ) {}

  static for(env: TestEnvironment, id: string): SubscriptionAssertions {
    return new SubscriptionAssertions(env, id);
  }

  async apiState(): Promise<SubscriptionState> {
    const res = await this.env.api.get(this.id);
    expect(res.status, `GET /subscriptions/${this.id}`).toBe(200);
    return res.body.state;
  }

  persistedState(): SubscriptionState {
    return this.env.repos.subscriptions.requireById(this.id).state;
  }

  /** The core cross-layer check: API answer == persisted row == expectation. */
  async hasState(expected: SubscriptionState): Promise<this> {
    expect(await this.apiState(), 'API-visible state').toBe(expected);
    expect(this.persistedState(), 'persisted state').toBe(expected);
    return this;
  }

  async apiAndPersistenceAgree(): Promise<this> {
    expect(await this.apiState()).toBe(this.persistedState());
    return this;
  }

  hasInvoiceCount(expected: number): this {
    const invoices = this.env.repos.invoices.findBySubscription(this.id);
    expect(invoices.length, `invoice rows for ${this.id}`).toBe(expected);
    return this;
  }

  hasInvoiceStatuses(...expected: InvoiceStatus[]): this {
    const statuses = this.env.repos.invoices.findBySubscription(this.id).map((i) => i.status);
    expect(statuses, `invoice statuses for ${this.id}`).toEqual(expected);
    return this;
  }

  countInvoicesWithStatus(status: InvoiceStatus): number {
    return this.env.repos.invoices.findBySubscription(this.id).filter((i) => i.status === status).length;
  }

  hasPaidInvoiceCount(expected: number): this {
    expect(this.countInvoicesWithStatus('paid'), `paid invoices for ${this.id}`).toBe(expected);
    return this;
  }

  hasNoInvoices(): this {
    return this.hasInvoiceCount(0);
  }

  /** Transition audit trail, by transition id — the lifecycle's black box recorder. */
  transitionIds(): string[] {
    return this.env.repos.subscriptionEvents
      .transitionsFor(this.id)
      .map((e) => e.transition_id as string);
  }

  hasTransitionTrail(...expected: string[]): this {
    expect(this.transitionIds(), `transition trail for ${this.id}`).toEqual(expected);
    return this;
  }

  hasNoTransitionsAfter(count: number): this {
    expect(this.transitionIds().length, `transition count for ${this.id}`).toBe(count);
    return this;
  }

  webhookOutcomes(): Array<{ event_id: string; outcome: string; reason: string | null }> {
    return this.env.repos.webhookEvents
      .findBySubscription(this.id)
      .map((e) => ({ event_id: e.event_id, outcome: e.outcome, reason: e.reason }));
  }

  hasWebhookEventRecorded(eventId: string, outcome: 'processed' | 'ignored', reason?: string): this {
    const record = this.env.repos.webhookEvents.findById(eventId);
    expect(record, `webhook_events row for ${eventId}`).not.toBeNull();
    expect(record!.outcome).toBe(outcome);
    if (reason !== undefined) expect(record!.reason).toBe(reason);
    return this;
  }

  hasWebhookEventCount(expected: number): this {
    expect(this.env.repos.webhookEvents.findBySubscription(this.id).length).toBe(expected);
    return this;
  }

  hasNotificationCount(type: string, expected: number): this {
    const sent = this.env.notifier
      .forSubscription(this.id)
      .filter((n) => n.type === (type as never));
    expect(sent.length, `${type} notifications for ${this.id}`).toBe(expected);
    return this;
  }
}
