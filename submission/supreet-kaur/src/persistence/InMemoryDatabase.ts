import { Subscription } from "../domain/Subscription";
import { Invoice } from "../domain/Invoice";
import { WebhookEventRecord } from "../domain/WebhookEventRecord";

/**
 * Deliberately dumb storage: three Maps. The assignment explicitly allows "an in-memory store
 * ... pick whatever keeps setup friction low" (Technology Choices section), and this keeps the
 * whole solution runnable with zero installs/native modules, which matters a lot for a
 * take-home someone else has to `git clone && npm install && npm test` in minutes.
 *
 * Each test creates a brand-new InMemoryDatabase (see test/support/TestFixture.ts), which is
 * how we get test isolation without a real DB teardown/truncate step -- there is nothing to
 * leak between tests because nothing is shared.
 */
export class InMemoryDatabase {
  readonly subscriptions = new Map<string, Subscription>();
  readonly invoices = new Map<string, Invoice>();
  readonly webhookEventsByEventId = new Map<string, WebhookEventRecord>();
  readonly webhookDeliveries: WebhookEventRecord[] = [];
}
