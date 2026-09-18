import { randomUUID } from "node:crypto";
import { Subscription } from "../domain/Subscription";
import { Invoice } from "../domain/Invoice";
import { PlanCatalog } from "../domain/Plan";
import { ValidationError, NotFoundError, InvalidTransitionError } from "../domain/errors";
import { PaymentProvider, ProviderDeclinedError, ProviderTimeoutError } from "../providers/PaymentProvider";
import { SubscriptionRepository } from "../persistence/SubscriptionRepository";
import { InvoiceRepository } from "../persistence/InvoiceRepository";
import { WebhookEventRepository } from "../persistence/WebhookEventRepository";
import { WebhookEventRecord, WebhookProcessingOutcome } from "../domain/WebhookEventRecord";
import { WebhookSignature } from "../security/webhookSignature";

export interface CreateSubscriptionInput {
  customerId: unknown;
  plan: unknown;
  paymentMethodId: unknown;
}

export interface WebhookProcessingResult {
  httpStatus: number;
  outcome: WebhookProcessingOutcome;
  body: Record<string, unknown>;
}

const KNOWN_CUSTOMERS = new Set(["cust_001", "cust_002", "cust_003", "cust_decline", "cust_timeout"]);
const KNOWN_WEBHOOK_TYPES = new Set(["payment.succeeded", "payment.failed", "payment.refunded"]);

/**
 * The only class in the codebase allowed to touch repositories AND the payment provider AND
 * subscription state transitions together -- everything else (API layer, tests) goes through
 * this. Keeping that orchestration in one seam is what makes "does the provider get called
 * exactly once per genuine billing attempt" answerable by reading one file.
 */
export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly signature: WebhookSignature
  ) {}

  // ---------------------------------------------------------------------------------------
  // Subscription CRUD
  // ---------------------------------------------------------------------------------------

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    if (typeof input.customerId !== "string" || input.customerId.length === 0) {
      throw new ValidationError("customer_id is required");
    }
    if (!KNOWN_CUSTOMERS.has(input.customerId)) {
      throw new ValidationError(`Unknown customer_id '${input.customerId}'`);
    }
    if (typeof input.paymentMethodId !== "string" || input.paymentMethodId.length === 0) {
      throw new ValidationError("payment_method_id is required");
    }
    if (typeof input.plan !== "string" || input.plan.length === 0) {
      throw new ValidationError("plan is required");
    }
    const plan = PlanCatalog.require(input.plan); // throws ValidationError for unknown plan

    const subscription = new Subscription(`sub_${randomUUID()}`, input.customerId, plan, input.paymentMethodId);
    this.subscriptions.save(subscription);

    if (plan.chargesImmediately) {
      // basic-tier subscriptions are charged as part of creation -- no trial window to wait out.
      await this.attemptCharge(subscription.id);
    }

    return subscription;
  }

  get(id: string): Subscription {
    const sub = this.subscriptions.findById(id);
    if (!sub) throw new NotFoundError(`Subscription '${id}' not found`);
    return sub;
  }

  async cancel(id: string): Promise<Subscription> {
    const sub = this.get(id);
    if (sub.status === "canceled") {
      throw new InvalidTransitionError(`Subscription '${id}' is already canceled`);
    }
    sub.currentState.onCancel(sub);
    this.subscriptions.save(sub);
    return sub;
  }

  // ---------------------------------------------------------------------------------------
  // Billing attempts (initial charge, trial-end charge, retry, recurring charge)
  //
  // In a real deployment this is invoked by a scheduler when a trial ends or a renewal is
  // due, and by a retry job for past_due subscriptions. This fixture has no scheduler, so
  // tests call attemptCharge directly to simulate "time passing" -- documented in DESIGN.md
  // as a deliberate simplification (Option 2 fixture, per the assignment).
  // ---------------------------------------------------------------------------------------

  async attemptCharge(subscriptionId: string): Promise<Invoice> {
    const sub = this.get(subscriptionId);
    if (sub.status === "canceled") {
      throw new InvalidTransitionError(`Cannot charge a canceled subscription '${subscriptionId}'`);
    }

    const invoice = new Invoice(`inv_${randomUUID()}`, sub.id, sub.plan.priceCents, sub.plan.currency, new Date());
    this.invoices.save(invoice);

    try {
      const acceptance = await this.paymentProvider.charge({
        customerId: sub.customerId,
        amountCents: sub.plan.priceCents,
        currency: sub.plan.currency,
        paymentMethodId: sub.paymentMethodId,
        idempotencyKey: invoice.id,
      });
      invoice.providerChargeId = acceptance.providerChargeId;
      // Stays "pending" -- final settlement arrives via payment.succeeded/payment.failed webhook.
      this.invoices.save(invoice);
    } catch (err) {
      if (err instanceof ProviderDeclinedError) {
        invoice.status = "failed";
        invoice.failureReason = "provider_declined";
      } else if (err instanceof ProviderTimeoutError) {
        invoice.status = "failed";
        invoice.failureReason = "provider_timeout";
      } else {
        throw err;
      }
      invoice.settledAt = new Date();
      this.invoices.save(invoice);
      sub.currentState.onPaymentFailed(sub);
      this.subscriptions.save(sub);
    }

    return invoice;
  }

  // ---------------------------------------------------------------------------------------
  // Webhook processing
  // ---------------------------------------------------------------------------------------

  /**
   * @param rawBody the exact bytes received on the wire (signature is verified over this, not
   *                over a re-serialized object -- see WebhookSignature docs)
   */
  handleWebhook(rawBody: string, signatureHeader: string | undefined | null): WebhookProcessingResult {
    const deliveryId = randomUUID();
    const receivedAt = new Date();

    if (!this.signature.verify(rawBody, signatureHeader)) {
      const record = new WebhookEventRecord(deliveryId, null, null, null, null, receivedAt, "rejected_signature");
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 401, outcome: "rejected_signature", body: { error: "invalid or missing signature" } };
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      const record = new WebhookEventRecord(deliveryId, null, null, null, null, receivedAt, "rejected_malformed");
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 400, outcome: "rejected_malformed", body: { error: "body is not valid JSON" } };
    }

    const shapeError = this.validateWebhookShape(payload);
    if (shapeError) {
      const record = new WebhookEventRecord(
        deliveryId,
        typeof payload?.event_id === "string" ? payload.event_id : null,
        typeof payload?.type === "string" ? payload.type : null,
        typeof payload?.subscription_id === "string" ? payload.subscription_id : null,
        typeof payload?.invoice_id === "string" ? payload.invoice_id : null,
        receivedAt,
        "rejected_malformed"
      );
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 400, outcome: "rejected_malformed", body: { error: shapeError } };
    }

    const { event_id: eventId, type, subscription_id: subscriptionId, invoice_id: invoiceId } = payload;

    // --- Idempotency gate: redelivery of an event we already processed is a pure no-op. ---
    if (this.webhookEvents.hasBeenProcessed(eventId)) {
      const record = new WebhookEventRecord(deliveryId, eventId, type, subscriptionId, invoiceId, receivedAt, "duplicate");
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 200, outcome: "duplicate", body: { received: true, note: "duplicate event_id, already processed" } };
    }

    const sub = this.subscriptions.findById(subscriptionId);
    if (!sub) {
      const record = new WebhookEventRecord(deliveryId, eventId, type, subscriptionId, invoiceId, receivedAt, "rejected_malformed");
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 404, outcome: "rejected_malformed", body: { error: `unknown subscription_id '${subscriptionId}'` } };
    }

    const invoice = this.invoices.findById(invoiceId);
    if (!invoice) {
      const record = new WebhookEventRecord(deliveryId, eventId, type, subscriptionId, invoiceId, receivedAt, "rejected_malformed");
      this.webhookEvents.recordDelivery(record);
      return { httpStatus: 404, outcome: "rejected_malformed", body: { error: `unknown invoice_id '${invoiceId}'` } };
    }

    const outcome = this.applyWebhookEvent(sub, invoice, type);

    const record = new WebhookEventRecord(deliveryId, eventId, type, subscriptionId, invoiceId, receivedAt, outcome);
    this.webhookEvents.recordDelivery(record);
    this.webhookEvents.markProcessed(record); // marks this event_id as seen -> future redeliveries are "duplicate"
    this.subscriptions.save(sub);
    this.invoices.save(invoice);

    return { httpStatus: 200, outcome, body: { received: true, resulting_status: sub.status } };
  }

  /** Applies a validated, non-duplicate webhook event to the invoice + subscription state machine. */
  private applyWebhookEvent(sub: Subscription, invoice: Invoice, type: string): WebhookProcessingOutcome {
    // Out-of-order / stale guard: once an invoice has been settled (succeeded or failed), a
    // later event for that SAME invoice cannot re-settle it. This is what stops a delayed
    // payment.failed from regressing a subscription that a payment.succeeded already activated
    // (Required Invariant E in the assignment).
    if (invoice.status !== "pending") {
      sub.recordIgnoredEvent(`stale '${type}' webhook for already-${invoice.status} invoice '${invoice.id}' ignored`);
      return "ignored";
    }

    const statusBefore = sub.status;

    if (type === "payment.succeeded") {
      invoice.status = "succeeded";
      invoice.settledAt = new Date();
      sub.currentState.onPaymentSucceeded(sub);
    } else if (type === "payment.failed") {
      invoice.status = "failed";
      invoice.failureReason = "payment_failed_webhook";
      invoice.settledAt = new Date();
      sub.currentState.onPaymentFailed(sub);
    } else {
      // payment.refunded
      sub.currentState.onPaymentRefunded(sub);
    }

    // If the state object chose to ignore the event (already canceled, duplicate success while
    // active, a failed retry that didn't yet exhaust retries, etc.), the lifecycle status will
    // not have moved even though the invoice may have settled -- report "ignored" so tests and
    // the audit trail can tell "caused a transition" apart from "was a structural no-op".
    return sub.status === statusBefore ? "ignored" : "applied";
  }

  private validateWebhookShape(payload: any): string | null {
    if (typeof payload !== "object" || payload === null) return "body must be a JSON object";
    if (typeof payload.event_id !== "string" || payload.event_id.length === 0) return "event_id is required";
    if (typeof payload.type !== "string" || !KNOWN_WEBHOOK_TYPES.has(payload.type)) {
      return `type must be one of ${Array.from(KNOWN_WEBHOOK_TYPES).join(", ")}`;
    }
    if (typeof payload.subscription_id !== "string" || payload.subscription_id.length === 0) {
      return "subscription_id is required";
    }
    if (typeof payload.invoice_id !== "string" || payload.invoice_id.length === 0) {
      return "invoice_id is required";
    }
    if (typeof payload.amount !== "number" || payload.amount <= 0) return "amount must be a positive number";
    if (typeof payload.currency !== "string" || payload.currency.length === 0) return "currency is required";
    return null;
  }
}
