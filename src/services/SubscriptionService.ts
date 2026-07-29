import { Subscription } from "../domain/subscription/Subscription";
import { TrialingState } from "../domain/subscription/TrialingState";
import { PlanFactory } from "../domain/plans/PlanFactory";
import { PaymentProvider } from "../providers/PaymentProvider";
import { SubscriptionRepository } from "../repositories/SubscriptionRepository";
import { InvoiceRepository } from "../repositories/InvoiceRepository";

import { SubscriptionStateFactory } from "../domain/subscription/SubscriptionStateFactory";



export interface CreateSubscriptionRequest {

    customerId: string;

    plan: string;

    paymentMethodId: string;

}



export class SubscriptionService {


    constructor(
        private subscriptionRepository: SubscriptionRepository,
        private invoiceRepository: InvoiceRepository,
        private paymentProvider: PaymentProvider
    ) {}



    async createSubscription(
        request: CreateSubscriptionRequest
    ) {


        const plan =
            PlanFactory.create(request.plan);



        const subscriptionId =
            `sub_${Date.now()}`;



        const subscription =
            new Subscription(

                subscriptionId,

                request.customerId,

                plan.getName(),

                new TrialingState()

            );



        this.subscriptionRepository.create({

            id:
                subscriptionId,

            customerId:
                request.customerId,

            plan:
                plan.getName(),

            status:
                subscription.getStatus(),

            createdAt:
                new Date().toISOString()

        });



        const chargeResult =
            await this.paymentProvider.charge({

                customerId:
                    request.customerId,

                amount:
                    plan.getPrice(),

                paymentMethodId:
                    request.paymentMethodId,

                referenceId:
                    subscriptionId

            });



        if (!chargeResult.success) {


            subscription.paymentFailed();



            this.subscriptionRepository.updateStatus(

                subscriptionId,

                subscription.getStatus()

            );

        }



        return {

            id:
                subscriptionId,

            customerId:
                request.customerId,

            plan:
                plan.getName(),

            status:
                subscription.getStatus(),

            trialDays:
                plan.getTrialDays()

        };

    }




    async cancelSubscription(
        subscriptionId: string
    ) {


        const existing =
            this.subscriptionRepository
                .findById(subscriptionId);



        if (!existing) {

            throw new Error(
                "Subscription not found"
            );

        }



        const subscription =
            new Subscription(

                existing.id,

                existing.customerId,

                existing.plan,

                SubscriptionStateFactory.create(
                    existing.status
                )

            );



        subscription.cancel();



        this.subscriptionRepository.updateStatus(

            subscriptionId,

            subscription.getStatus()

        );



        return {

            id:
                subscriptionId,

            status:
                subscription.getStatus()

        };

    }





    async processPaymentSuccess(
        subscriptionId: string
    ) {


        const subscriptionRecord =
            this.subscriptionRepository
                .findById(subscriptionId);



        if (!subscriptionRecord) {

            throw new Error(
                "Subscription not found"
            );

        }



        const subscription =
            new Subscription(

                subscriptionRecord.id,

                subscriptionRecord.customerId,

                subscriptionRecord.plan,

                SubscriptionStateFactory.create(
                    subscriptionRecord.status
                )

            );



        subscription.paymentSucceeded();



        this.subscriptionRepository.updateStatus(

            subscriptionId,

            subscription.getStatus()

        );



        /*
         * Do not create duplicate invoices
         */

        const existingInvoices =
            this.invoiceRepository
                .findBySubscription(
                    subscriptionId
                );



        if (existingInvoices.length === 0) {


            this.invoiceRepository.create({

                id:
                    `inv_${Date.now()}`,

                subscriptionId,

                amount:
                    PlanFactory
                        .create(subscriptionRecord.plan)
                        .getPrice(),

                status:
                    "paid",

                createdAt:
                    new Date().toISOString()

            });

        }



        return {

            subscriptionId,

            status:
                subscription.getStatus()

        };

    }





    async processPaymentFailure(
        subscriptionId: string
    ) {


        const subscriptionRecord =
            this.subscriptionRepository
                .findById(subscriptionId);



        if (!subscriptionRecord) {

            throw new Error(
                "Subscription not found"
            );

        }



        const subscription =
            new Subscription(

                subscriptionRecord.id,

                subscriptionRecord.customerId,

                subscriptionRecord.plan,

                SubscriptionStateFactory.create(
                    subscriptionRecord.status
                )

            );



        subscription.paymentFailed();



        this.subscriptionRepository.updateStatus(

            subscriptionId,

            subscription.getStatus()

        );



        return {

            subscriptionId,

            status:
                subscription.getStatus()

        };

    }


}