import { SubscriptionRequestBuilder } from '../builders/subscription-request-builder';
import { WebhookEventBuilder } from '../builders/webhook-event-builder';
import type { SubscriptionResource } from '../clients/subscription-api-client';
import type { TestEnvironment } from './test-environment';

export interface ScenarioOptions {
  plan?: string;
  customerId?: string;
  paymentMethodId?: string;
}

/**
 * Scenario director: builds subscriptions that are *already in* a given
 * lifecycle state, so a test about past_due behaviour is not buried under the
 * ten lines of arrange that got it there.
 */
export class SubscriptionScenarios {
  constructor(private readonly env: TestEnvironment) {}

  private request(options: ScenarioOptions) {
    const builder = SubscriptionRequestBuilder.aRequest().onPlan(options.plan ?? 'pro');
    if (options.customerId) builder.forCustomer(options.customerId);
    if (options.paymentMethodId) builder.withPaymentMethod(options.paymentMethodId);
    return builder.build();
  }

  /** trialing */
  async trialing(options: ScenarioOptions = {}): Promise<SubscriptionResource> {
    return this.env.api.createOrThrow(this.request(options));
  }

  /** trialing -> active, via a successful first charge at trial end. */
  async active(options: ScenarioOptions = {}): Promise<SubscriptionResource> {
    const sub = await this.trialing(options);
    const plan = this.env.system.plans.get(sub.plan);
    this.env.advanceDays(plan.trialDays);
    this.env.provider.succeedsOnce();
    await this.env.runBillingCycle();
    return this.refresh(sub.id);
  }

  /** trialing -> past_due, via a declined first charge at trial end. */
  async pastDue(options: ScenarioOptions = {}): Promise<SubscriptionResource> {
    const sub = await this.trialing(options);
    const plan = this.env.system.plans.get(sub.plan);
    this.env.advanceDays(plan.trialDays);
    this.env.provider.declinesOnce();
    await this.env.runBillingCycle();
    return this.refresh(sub.id);
  }

  /** active -> canceled, via the API. */
  async canceled(options: ScenarioOptions = {}): Promise<SubscriptionResource> {
    const sub = await this.active(options);
    const res = await this.env.api.cancel(sub.id);
    if (res.status !== 200) throw new Error(`Cancel failed: ${JSON.stringify(res.body)}`);
    return this.refresh(sub.id);
  }

  /**
   * An active subscription whose *next* charge timed out: the invoice is still
   * pending and the asynchronous webhook decides the outcome.
   */
  async awaitingProviderResult(options: ScenarioOptions = {}): Promise<SubscriptionResource> {
    const sub = await this.trialing(options);
    const plan = this.env.system.plans.get(sub.plan);
    this.env.advanceDays(plan.trialDays);
    this.env.provider.timesOutOnce();
    await this.env.runBillingCycle();
    return this.refresh(sub.id);
  }

  /** Delivers a signed provider event for the subscription's latest invoice. */
  async deliverEventForLatestInvoice(
    subscriptionId: string,
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded'
  ) {
    const invoice = await this.env.latestInvoice(subscriptionId);
    const payload = WebhookEventBuilder.anEvent().ofType(type).forInvoice(invoice).build();
    const response = await this.env.webhooks.deliver(payload);
    return { payload, response };
  }

  async refresh(id: string): Promise<SubscriptionResource> {
    const res = await this.env.api.get(id);
    if (res.status !== 200) throw new Error(`Subscription ${id} not retrievable: ${res.status}`);
    return res.body;
  }
}
