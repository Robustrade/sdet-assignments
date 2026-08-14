import { SubscriptionRepository } from "../repositories/SubscriptionRepository";
import { Subscription } from "../domain/Subscription";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";
import { PaymentProvider } from "../payment/PaymentProvider";
import { InvoiceRepository } from "../repositories/InvoiceRepository";
import { WebhookEventRepository } from "../repositories/WebhookEventRepository";
import { SubscriptionStateMachine } from "../state-machine/SubscriptionStateMachine";
import crypto from "crypto";

type PlanConfig = { price: number; currency: string; trialDays: number };

const PLANS: Record<string, PlanConfig> = {
    basic: { price: 1000, currency: "USD", trialDays: 14 },
    pro: { price: 4900, currency: "USD", trialDays: 0 }
};

export class SubscriptionService {
    private repository: SubscriptionRepository;
    private provider: PaymentProvider;
    private invoiceRepo: InvoiceRepository;
    private webhookRepo: WebhookEventRepository;
    private webhookSecret = "test_secret";

    constructor(options: {
        repository?: SubscriptionRepository;
        provider: PaymentProvider;
        invoiceRepo?: InvoiceRepository;
        webhookRepo?: WebhookEventRepository;
    }) {
        this.repository = options.repository || new SubscriptionRepository();
        this.provider = options.provider;
        this.invoiceRepo = options.invoiceRepo || new InvoiceRepository();
        this.webhookRepo = options.webhookRepo || new WebhookEventRepository();
    }

    createSubscription(request: any) {
        if (!request.customer_id) {
            return { status: 400, body: { error: "customer_id is required" } };
        }
        if (!request.payment_method_id) {
            return { status: 400, body: { error: "payment_method_id is required" } };
        }
        const plan = request.plan;
        if (!PLANS[plan]) {
            return { status: 400, body: { error: "Invalid subscription plan" } };
        }

        const id = `sub_${Date.now()}`;
        const config = PLANS[plan];
        const initialStatus = config.trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.TRIALING;
        const subscription = new Subscription(id, request.customer_id, plan, request.payment_method_id, initialStatus);
        this.repository.save(subscription);

        // Immediately charge if no trial
        if (config.trialDays === 0) {
            const invoiceId = `inv_${Date.now()}`;
            this.invoiceRepo.create({ id: invoiceId, subscriptionId: id, amount: config.price, currency: config.currency, status: "pending" });

            // call provider
            return this.provider.charge({ amount: config.price, currency: config.currency, customerId: request.customer_id, paymentMethodId: request.payment_method_id, idempotencyKey: invoiceId })
                .then(res => {
                    if (res.success) {
                        this.repository.updateStatus(id, SubscriptionStatus.ACTIVE);
                        this.invoiceRepo.create({ id: `${invoiceId}_paid`, subscriptionId: id, amount: config.price, currency: config.currency, status: "paid" });
                        return { status: 201, body: { subscription: { ...subscription, status: SubscriptionStatus.ACTIVE } } };
                    } else {
                        this.repository.updateStatus(id, SubscriptionStatus.PAST_DUE);
                        this.invoiceRepo.create({ id: `${invoiceId}_failed`, subscriptionId: id, amount: config.price, currency: config.currency, status: "failed" });
                        return { status: 201, body: { subscription: { ...subscription, status: SubscriptionStatus.PAST_DUE } } };
                    }
                });
        }

        return Promise.resolve({ status: 201, body: subscription });
    }

    cancelSubscription(id: string) {
        const sub = this.repository.findById(id);
        if (!sub) return { status: 404, body: { error: "not found" } };
        if (sub.status === SubscriptionStatus.CANCELED) return { status: 400, body: { error: "already canceled" } };
        this.repository.updateStatus(id, SubscriptionStatus.CANCELED);
        return { status: 200, body: { id, status: SubscriptionStatus.CANCELED } };
    }

    verifySignature(rawBody: string, signature: string | undefined) {
        if (!signature) return false;
        const expected = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
        return signature === expected;
    }

    async handleWebhook(rawBody: string, signature: string | undefined) {
        if (!this.verifySignature(rawBody, signature)) {
            return { status: 400, body: { error: "invalid signature" } };
        }

        const payload = JSON.parse(rawBody);
        if (this.webhookRepo.exists(payload.event_id)) {
            return { status: 200, body: { ok: true, idempotent: true } };
        }

        // record event for idempotency
        this.webhookRepo.recordEvent(payload.event_id, payload.type, rawBody);

        const subscription = this.repository.findById(payload.subscription_id);
        if (!subscription) return { status: 404, body: { error: "subscription not found" } };

        // Cancelled subscriptions ignore webhooks
        if (subscription.status === SubscriptionStatus.CANCELED) return { status: 200, body: { ok: true, ignored: true } };

        if (payload.type === "payment.succeeded") {
            // move to active
            if (SubscriptionStateMachine.canTransition(subscription.status as any, SubscriptionStatus.ACTIVE)) {
                this.repository.updateStatus(subscription.id, SubscriptionStatus.ACTIVE);
                this.invoiceRepo.create({ id: payload.invoice_id || `inv_${Date.now()}`, subscriptionId: subscription.id, amount: payload.amount || 0, currency: payload.currency || "USD", status: "paid" });
            }
        } else if (payload.type === "payment.failed") {
            if (SubscriptionStateMachine.canTransition(subscription.status as any, SubscriptionStatus.PAST_DUE)) {
                this.repository.updateStatus(subscription.id, SubscriptionStatus.PAST_DUE);
                this.invoiceRepo.create({ id: payload.invoice_id || `inv_${Date.now()}`, subscriptionId: subscription.id, amount: payload.amount || 0, currency: payload.currency || "USD", status: "failed" });
            }
        }

        return { status: 200, body: { processed: true } };
    }
}