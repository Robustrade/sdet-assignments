
import { randomUUID } from "crypto";
import { Invoice } from "../domain/Invoice";
import { PlanCatalog } from "../domain/Plan";
import { PaymentProvider } from "../providers/PaymentProvider";
import { InvoiceRepository } from "../repositories/InvoiceRepository";
import { SubscriptionService } from "./SubscriptionService";

export class BillingService {
    private readonly inFlightRequests = new Map<
        string,
        {
            subscriptionId: string;
            promise: Promise<Invoice>;
        }
    >();

    private readonly billingQueues =
        new Map<string, Promise<void>>();


    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly invoiceRepository: InvoiceRepository,
        private readonly paymentProvider: PaymentProvider,
        private readonly planCatalog: PlanCatalog
    ) { }

    async billSubscription(
        subscriptionId: string,
        paymentMethodId: string,
        idempotencyKey: string
    ): Promise<Invoice> {
        if (!paymentMethodId?.trim() || !idempotencyKey?.trim()) {
            throw new Error(
                "Payment method and idempotency key are required"
            );
        }

        const inFlight = this.inFlightRequests.get(idempotencyKey);

        if (inFlight) {
            if (inFlight.subscriptionId !== subscriptionId) {
                throw new Error("Idempotency key conflict");
            }

            return inFlight.promise;
        }

        const promise = this.enqueueBilling(
            subscriptionId,
            paymentMethodId,
            idempotencyKey
        );

        this.inFlightRequests.set(idempotencyKey, {
            subscriptionId,
            promise
        });

        try {
            return await promise;
        } finally {
            this.inFlightRequests.delete(idempotencyKey);
        }
    }

    private enqueueBilling(
        subscriptionId: string,
        paymentMethodId: string,
        idempotencyKey: string
    ): Promise<Invoice> {
        const previous =
            this.billingQueues.get(subscriptionId)
            ?? Promise.resolve();

        const current = previous.then(() =>
            this.processBilling(
                subscriptionId,
                paymentMethodId,
                idempotencyKey
            )
        );

        const completion = current.then(
            () => undefined,
            () => undefined
        );

        this.billingQueues.set(
            subscriptionId,
            completion
        );

        return current.finally(() => {
            if (
                this.billingQueues.get(subscriptionId)
                === completion
            ) {
                this.billingQueues.delete(subscriptionId);
            }
        });
    }


    private async processBilling(
        subscriptionId: string,
        paymentMethodId: string,
        idempotencyKey: string
    ): Promise<Invoice> {
        const existing =
            await this.invoiceRepository.findByIdempotencyKey(
                idempotencyKey
            );

        if (existing) {
            if (existing.subscriptionId !== subscriptionId) {
                throw new Error("Idempotency key conflict");
            }

            return existing;
        }

        const subscription =
            await this.subscriptionService.getSubscription(
                subscriptionId
            );

        if (!subscription) {
            throw new Error("Subscription not found");
        }

        if (subscription.status === "canceled") {
            throw new Error("Cannot bill a canceled subscription");
        }

        const plan = this.planCatalog.getPlan(
            subscription.planId
        );

        const now = new Date();

        const invoice: Invoice = {
            id: randomUUID(),
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            amount: plan.amount,
            currency: plan.currency,
            status: "pending",
            idempotencyKey,
            createdAt: now,
            updatedAt: now
        };

        await this.invoiceRepository.save(invoice);

        let result;

        try {
            result = await this.paymentProvider.charge({
                customerId: subscription.customerId,
                paymentMethodId,
                amount: plan.amount,
                currency: plan.currency,
                idempotencyKey
            });
        } catch {
            invoice.status = "timeout";
            invoice.updatedAt = new Date();

            await this.invoiceRepository.save(invoice);

            return invoice;
        }

        invoice.transactionId = result.transactionId;

        invoice.status =
            result.status === "succeeded" ? "paid" : "failed";

        invoice.updatedAt = new Date();

        await this.invoiceRepository.save(invoice);

        await this.subscriptionService.recordPaymentOutcome(
            subscriptionId,
            result.status === "succeeded"

        );

        return invoice;
    }
}
