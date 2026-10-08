import { InvoiceRepository } from '../../src/db/invoice.repository';
import { SubscriptionRepository } from '../../src/db/subscription.repository';
import { WebhookEventRepository } from '../../src/db/webhook-event.repository';
import { ApiResponse } from '../../src/service/subscription-billing.service';

export class PersistenceVerifier {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly webhookEvents: WebhookEventRepository,
  ) {}

  assertApiMatchesPersistence(subscriptionId: string, response: ApiResponse): void {
    const persisted = this.subscriptions.findById(subscriptionId);
    if (!persisted) {
      throw new Error(`Expected subscription "${subscriptionId}" to be persisted`);
    }
    const body = response.body as { id?: string; status?: string; plan?: string };
    if (response.statusCode < 200 || response.statusCode >= 300
      || body.id !== persisted.id || body.status !== persisted.status || body.plan !== persisted.plan) {
      throw new Error(`API response does not match persisted subscription "${subscriptionId}"`);
    }
  }

  assertActiveHasSuccessfulPayment(subscriptionId: string): void {
    const subscription = this.subscriptions.findById(subscriptionId);
    const hasSuccessfulPayment = this.invoices.findBySubscriptionId(subscriptionId)
      .some((invoice) => invoice.status === 'succeeded' || invoice.status === 'refunded');
    if (subscription?.status === 'active' && !hasSuccessfulPayment) {
      throw new Error(`Active subscription "${subscriptionId}" has no successful persisted payment`);
    }
  }

  assertCanceledIsTerminal(subscriptionId: string): void {
    const subscription = this.subscriptions.findById(subscriptionId);
    if (subscription?.status === 'canceled'
      && subscription.history.some((entry) => entry.startsWith('canceled->'))) {
      throw new Error(`Canceled subscription "${subscriptionId}" has a subsequent transition`);
    }
  }

  assertWebhookDeliveries(eventId: string, deliveryCount: number): void {
    const event = this.webhookEvents.findById(eventId);
    if (event?.deliveryCount !== deliveryCount) {
      throw new Error(`Expected webhook "${eventId}" to have ${deliveryCount} deliveries`);
    }
  }
}
