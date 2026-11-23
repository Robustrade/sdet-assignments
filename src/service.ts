import express, { Request, Response } from "express";
import { createHmac, timingSafeEqual, randomUUID } from "crypto";
import { InMemoryRepository } from "./repository";
import { FakePaymentProvider, ChargeResult, PaymentProvider } from "./provider";
import { Invoice, PLANS, Subscription, WebhookEvent } from "./domain";
import { SubscriptionStateMachine } from "./stateMachine";

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export class BillingService {
  readonly app = express();
  readonly secret: string;

  constructor(
    readonly repository = new InMemoryRepository(),
    readonly provider: PaymentProvider = new FakePaymentProvider(),
    secret = "test-webhook-secret"
  ) {
    this.secret = secret;
    this.app.use(express.json({
      verify: (req, _res, body) => {
        (req as Request).rawBody = body.toString("utf8");
      }
    }));
    this.routes();
  }

  private validSignature(req: Request): boolean {
    const signature = req.header("X-Provider-Signature");
    if (!signature || !req.rawBody) return false;
    const expected = createHmac("sha256", this.secret).update(req.rawBody).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private routes(): void {
    this.app.post("/subscriptions", (req, res) => {
      const { customer_id, plan, payment_method_id } = req.body ?? {};
      if (!customer_id || typeof customer_id !== "string") {
        res.status(400).json({ error: "missing or invalid customer_id" });
        return;
      }
      if (!["cust_001", "cust_002"].includes(customer_id)) {
        res.status(400).json({ error: "unknown customer" });
        return;
      }
      if (!plan || !["basic", "pro"].includes(plan)) {
        res.status(400).json({ error: "invalid plan" });
        return;
      }
      if (!payment_method_id || typeof payment_method_id !== "string") {
        res.status(400).json({ error: "missing or invalid payment_method_id" });
        return;
      }

      const now = new Date().toISOString();
      const planConfig = PLANS[plan as keyof typeof PLANS];
      const subscription: Subscription = {
        id: `sub_${randomUUID()}`,
        customerId: customer_id,
        plan,
        paymentMethodId: payment_method_id,
        status: planConfig.initialStatus,
        retryCount: 0,
        createdAt: now,
        updatedAt: now
      };
      this.repository.subscriptions.set(subscription.id, subscription);
      this.repository.recordAudit(subscription.id, subscription.status, subscription.status, "subscription_created");
      res.status(201).json(subscription);
    });

    this.app.get("/subscriptions/:id", (req, res) => {
      const subscription = this.repository.subscriptions.get(req.params.id);
      if (!subscription) {
        res.status(404).json({ error: "subscription not found" });
        return;
      }
      res.status(200).json(subscription);
    });

    this.app.post("/subscriptions/:id/cancel", (req, res) => {
      const subscription = this.repository.subscriptions.get(req.params.id);
      if (!subscription) {
        res.status(404).json({ error: "subscription not found" });
        return;
      }
      const machine = new SubscriptionStateMachine(subscription.status);
      const next = machine.transition("customer_cancel");
      if (!next) {
        res.status(409).json({ error: "subscription cannot be canceled from its current state" });
        return;
      }
      const previous = subscription.status;
      subscription.status = next;
      subscription.updatedAt = new Date().toISOString();
      this.repository.recordAudit(subscription.id, previous, next, "customer_cancel");
      res.status(200).json(subscription);
    });

    this.app.post("/webhooks/payment-provider", (req, res) => {
      if (!this.validSignature(req)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }
      const body = req.body ?? {};
      if (
        !body.event_id || typeof body.event_id !== "string" ||
        !body.subscription_id || !body.invoice_id ||
        !["payment.succeeded", "payment.failed", "payment.refunded"].includes(body.type)
      ) {
        res.status(400).json({ error: "malformed webhook payload" });
        return;
      }
      const existing = this.repository.webhookEvents.get(body.event_id);
      if (existing) {
        res.status(200).json({ event_id: body.event_id, duplicate: true });
        return;
      }

      const subscription = this.repository.subscriptions.get(body.subscription_id);
      if (!subscription) {
        res.status(404).json({ error: "subscription not found" });
        return;
      }

      const event: WebhookEvent = {
        eventId: body.event_id,
        type: body.type,
        subscriptionId: body.subscription_id,
        invoiceId: body.invoice_id,
        processed: true,
        receivedAt: new Date().toISOString()
      };
      this.repository.webhookEvents.set(body.event_id, event);

      if (subscription.status === "canceled") {
        res.status(200).json({ event_id: body.event_id, duplicate: false, ignored: true });
        return;
      }

      let invoice = this.repository.invoices.get(body.invoice_id);
      if (!invoice) {
        const plan = PLANS[subscription.plan];
        invoice = {
          id: body.invoice_id,
          subscriptionId: subscription.id,
          amount: typeof body.amount === "number" ? body.amount : plan.price,
          currency: body.currency === "USD" ? "USD" : plan.currency,
          status: "pending",
          providerReference: "",
          createdAt: new Date().toISOString()
        };
        this.repository.invoices.set(invoice.id, invoice);
      }

      if (body.type === "payment.failed" && invoice.status === "succeeded") {
        res.status(200).json({ event_id: body.event_id, duplicate: false, ignored: true });
        return;
      }

      const machine = new SubscriptionStateMachine(subscription.status);
      const previous = subscription.status;
      if (body.type === "payment.succeeded") {
        invoice.status = "succeeded";
        const trigger = previous === "trialing" ? "trial_end_charge_success" : "retry_charge_success";
        const next = machine.transition(trigger);
        if (next) {
          subscription.status = next;
          this.repository.recordAudit(subscription.id, previous, next, body.event_id);
        }
      } else if (body.type === "payment.failed") {
        invoice.status = "failed";
        const trigger = previous === "trialing"
          ? "trial_end_charge_failure"
          : previous === "past_due" && subscription.retryCount >= 2
            ? "retries_exhausted"
            : "recurring_charge_failure";
        const next = machine.transition(trigger);
        subscription.retryCount += 1;
        if (next) {
          subscription.status = next;
          this.repository.recordAudit(subscription.id, previous, next, body.event_id);
        }
      } else if (body.type === "payment.refunded") {
        invoice.status = "refunded";
      }
      subscription.updatedAt = new Date().toISOString();
      res.status(200).json({ event_id: body.event_id, duplicate: false });
    });
  }

  bill(subscriptionId: string, invoiceId: string): ChargeResult {
    const subscription = this.repository.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error("subscription not found");
    const plan = PLANS[subscription.plan];
    const result = this.provider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amount: plan.price,
      currency: "USD",
      idempotencyKey: `invoice_${invoiceId}`,
      invoiceId
    });
    let invoice = this.repository.invoices.get(invoiceId);
    if (!invoice) {
      invoice = {
        id: invoiceId,
        subscriptionId,
        amount: plan.price,
        currency: "USD",
        status: "pending",
        providerReference: result.providerReference,
        createdAt: new Date().toISOString()
      };
      this.repository.invoices.set(invoiceId, invoice);
    }
    invoice.providerReference = result.providerReference;
    return result;
  }
}
