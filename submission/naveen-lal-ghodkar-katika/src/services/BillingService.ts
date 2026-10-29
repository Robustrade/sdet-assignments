import { BillingError } from '../errors';
import type { InvoiceRecord } from '../domain/Invoice';
import type { SubscriptionRecord } from '../domain/Subscription';
import type { SubscriptionTrigger } from '../domain/SubscriptionStateMachine';
import { ProviderTimeoutError, type ChargeRequest, type PaymentProvider } from '../providers/PaymentProvider';

/** The provider's answer, translated for the rest of the service. */
export interface ChargeOutcome {
  /** To be applied through the state machine. */
  readonly trigger: Extract<SubscriptionTrigger, 'charge_succeeded' | 'charge_failed'>;
  readonly providerChargeId?: string;
  readonly declineCode?: string;
}

/**
 * The only place that talks to the payment provider. It turns a subscription's price into a
 * charge request and the provider's answer into a state-machine trigger; it never sets a status.
 */
export class BillingService {
  constructor(private readonly provider: PaymentProvider) {}

  /**
   * Charge the first invoice of a subscription.
   *
   * The idempotency key is derived from the subscription id, so every attempt for the same
   * subscription (including a retry after a timeout) carries the same key and the provider can
   * deduplicate it.
   *
   * @throws BillingError('provider_timeout') when the outcome is unknown; nothing may be activated.
   */
  async chargeInitial(subscription: SubscriptionRecord, paymentMethodId: string): Promise<ChargeOutcome> {
    return this.send({
      customerId: subscription.customerId,
      paymentMethodId,
      amount: subscription.priceCents,
      currency: subscription.currency,
      idempotencyKey: initialChargeKey(subscription.id),
      reference: subscription.id,
    });
  }

  /**
   * Charge an invoice that the billing run created (trial end, recurring period or retry).
   * The request is built from the invoice, so what is charged is exactly what is recorded, and
   * sending the same invoice again after a timeout repeats the same idempotency key.
   *
   * @throws BillingError('provider_timeout') when the outcome is unknown; the invoice stays pending.
   */
  async chargeInvoice(subscription: SubscriptionRecord, invoice: InvoiceRecord): Promise<ChargeOutcome> {
    return this.send({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amount: invoice.amount,
      currency: invoice.currency,
      idempotencyKey: invoice.idempotencyKey,
      reference: subscription.id,
    });
  }

  private async send(request: ChargeRequest): Promise<ChargeOutcome> {
    try {
      const result = await this.provider.charge(request);
      return result.status === 'succeeded'
        ? { trigger: 'charge_succeeded', providerChargeId: result.providerChargeId }
        : { trigger: 'charge_failed', declineCode: result.declineCode };
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        throw new BillingError('provider_timeout', 'Payment provider did not answer; the charge outcome is unknown');
      }
      throw error;
    }
  }
}

/** Shared by the provider request and the stored invoice, so the two can never disagree. */
export function initialChargeKey(subscriptionId: string): string {
  return `initial:${subscriptionId}`;
}

/**
 * Idempotency key of billing attempt `attempt` (1-based). The first attempt keeps the key of the
 * initial charge, whether it happens at creation (no-trial plan) or at trial end; later attempts
 * (recurring periods, retries) each get their own, so the provider never mistakes them for a resend.
 */
export function chargeKeyForAttempt(subscriptionId: string, attempt: number): string {
  return attempt === 1 ? initialChargeKey(subscriptionId) : `attempt:${subscriptionId}:${attempt}`;
}
