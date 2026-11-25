
import { WebhookEvent } from "../domain/WebhookEvent";
import { InvoiceRepository } from "../repositories/InvoiceRepository";
import { WebhookEventRepository } from "../repositories/WebhookEventRepository";
import { SubscriptionService } from "./SubscriptionService";
import { WebhookSignature } from "./WebhookSignature";

export type WebhookResult =
    | "processed"
    | "duplicate"
    | "ignored";

export class WebhookService {
    private queue: Promise<void> = Promise.resolve();
    private readonly pendingActivations =
        new Map<string, string>();

    constructor(
        private readonly invoiceRepository: InvoiceRepository,
        private readonly eventRepository: WebhookEventRepository,
        private readonly subscriptionService: SubscriptionService,
        private readonly signatureVerifier: WebhookSignature
    ) { }

    async process(
        payload: string,
        signature: string
    ): Promise<WebhookResult> {
        if (!this.signatureVerifier.verify(payload, signature)) {
            throw new Error("Invalid webhook signature");
        }

        let event: WebhookEvent;

        try {
            event = JSON.parse(payload);
        } catch {
            throw new Error("Invalid webhook payload");
        }

        if (
            !event ||
            typeof event.event_id !== "string" ||
            !event.event_id.trim() ||
            typeof event.subscription_id !== "string" ||
            !event.subscription_id.trim() ||
            typeof event.invoice_id !== "string" ||
            !event.invoice_id.trim() ||
            !Number.isSafeInteger(event.amount) ||
            event.amount < 0 ||
            typeof event.currency !== "string"
        ) {
            throw new Error("Invalid webhook event");
        }

        if (
            ![
                "payment.succeeded",
                "payment.failed",
                "payment.refunded"
            ].includes(event.type)
        ) {
            throw new Error("Unsupported webhook event");
        }

        const operation = this.queue.then(async () => {
            const outcome = await this.processEvent(event);

            await this.eventRepository.saveAudit({
                eventId: event.event_id,
                eventType: event.type,
                subscriptionId: event.subscription_id,
                invoiceId: event.invoice_id,
                outcome,
                processedAt: new Date()
            });

            return outcome;
        });

        this.queue = operation.then(
            () => undefined,
            () => undefined
        );

        return operation;
    }

    private async processEvent(
        event: WebhookEvent
    ): Promise<WebhookResult> {
        if (await this.eventRepository.exists(event.event_id)) {
            return "duplicate";
        }

        const invoice = await this.invoiceRepository.findById(
            event.invoice_id
        );

        if (!invoice) {
            throw new Error("Invoice not found");
        }

        if (invoice.subscriptionId !== event.subscription_id) {
            throw new Error("Subscription mismatch");
        }

        if (
            invoice.amount !== event.amount ||
            invoice.currency !== event.currency
        ) {
            throw new Error("Invoice amount or currency mismatch");
        }

        const subscription =
            await this.subscriptionService.getSubscription(
                event.subscription_id
            );

        if (!subscription) {
            throw new Error("Subscription not found");
        }

        let ignored = false;

        switch (event.type) {
            case "payment.succeeded":
                if (invoice.status === "refunded") {
                    ignored = true;
                    break;
                }

                if (invoice.status === "paid") {
                    if (
                        this.pendingActivations.get(invoice.id) !==
                        event.event_id
                    ) {
                        ignored = true;
                        break;
                    }
                } else {
                    invoice.status = "paid";
                    invoice.updatedAt = new Date();

                    await this.invoiceRepository.save(invoice);

                    this.pendingActivations.set(
                        invoice.id,
                        event.event_id
                    );
                }

                if (
                    subscription.status !== "active" &&
                    subscription.status !== "canceled"
                ) {
                    await this.subscriptionService.changeStatus(
                        subscription.id,
                        "active"
                    );
                }

                this.pendingActivations.delete(invoice.id);

                break;
            case "payment.failed":
                if (
                    invoice.status === "paid" ||
                    invoice.status === "refunded" ||
                    invoice.status === "failed"
                ) {
                    ignored = true;
                    break;
                }

                invoice.status = "failed";

                if (
                    subscription.status !== "past_due" &&
                    subscription.status !== "canceled"
                ) {
                    await this.subscriptionService.changeStatus(
                        subscription.id,
                        "past_due"
                    );
                }

                break;

            case "payment.refunded":
                if (invoice.status === "refunded") {
                    ignored = true;
                    break;
                }

                if (invoice.status !== "paid") {
                    throw new Error("Only paid invoices can be refunded");
                }

                invoice.status = "refunded";
                break;
        }

        if (!ignored && event.type !== "payment.succeeded") {
            invoice.updatedAt = new Date();

            await this.invoiceRepository.save(invoice);
        }

        await this.eventRepository.markProcessed(
            event.event_id
        );

        return ignored ? "ignored" : "processed";
    }
}
