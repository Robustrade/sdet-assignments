import { WebhookEventRepository } from "../repositories/WebhookEventRepository";
import { InvoiceRepository } from "../repositories/InvoiceRepository";
import { SubscriptionService } from "./SubscriptionService";


export class WebhookService {


    constructor(
        private webhookRepository: WebhookEventRepository,
        private subscriptionService: SubscriptionService,
        private invoiceRepository: InvoiceRepository
    ) {}



    async process(payload:any) {


        const eventId =
            payload.event_id;



        if(
            this.webhookRepository.exists(eventId)
        ) {

            return {

                message:
                    "duplicate event ignored"

            };

        }



        /*
         * Ignore late payment.failed events
         * when the invoice was already paid.
         */
        if(
            payload.type === "payment.failed"
        ) {


            const invoices =
                this.invoiceRepository
                    .findBySubscription(
                        payload.subscription_id
                    );



            const paidInvoice =
                invoices.find(
                    (invoice: any) =>
                        invoice.status === "paid"
                );



            if(paidInvoice) {

                this.webhookRepository.create({

                    eventId,

                    type:
                        payload.type,

                    subscriptionId:
                        payload.subscription_id,

                    processedAt:
                        new Date().toISOString()

                });



                return {

                    message:
                        "late payment failure ignored"

                };

            }

        }



        this.webhookRepository.create({

            eventId,

            type:
                payload.type,

            subscriptionId:
                payload.subscription_id,

            processedAt:
                new Date().toISOString()

        });




        switch(payload.type) {


            case "payment.succeeded":

                return await this.subscriptionService
                    .processPaymentSuccess(
                        payload.subscription_id
                    );



            case "payment.failed":

                return await this.subscriptionService
                    .processPaymentFailure(
                        payload.subscription_id
                    );



            default:

                return {

                    message:
                        "event ignored"

                };

        }

    }

}