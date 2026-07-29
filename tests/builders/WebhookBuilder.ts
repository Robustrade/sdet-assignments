import { WebhookEvent } from "../../src/domain/webhook/WebhookEvent";


export class WebhookBuilder {


    private webhook: WebhookEvent = {

        eventId:
            `evt_${Date.now()}`,

        type:
            "payment.succeeded",

        subscriptionId:
            "sub_test_001",

        processedAt:
            new Date().toISOString()

    };



    paymentSucceeded(){

        this.webhook.type =
            "payment.succeeded";

        return this;

    }



    paymentFailed(){

        this.webhook.type =
            "payment.failed";

        return this;

    }



    forSubscription(
        subscriptionId:string
    ){

        this.webhook.subscriptionId =
            subscriptionId;

        return this;

    }



    withEventId(
        eventId:string
    ){

        this.webhook.eventId =
            eventId;

        return this;

    }



    build(){

        return this.webhook;

    }

}