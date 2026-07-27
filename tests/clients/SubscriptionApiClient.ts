import request from "supertest";


export class SubscriptionApiClient {


    constructor(
        private app:any
    ){}



    async createSubscription(
        payload:{
            customerId:string;
            plan:string;
            paymentMethodId:string;
        }
    ){

        return request(this.app)
            .post("/subscriptions")
            .send({

                customerId:
                    payload.customerId,

                plan:
                    payload.plan,

                paymentMethodId:
                    payload.paymentMethodId
            });

    }




    async cancelSubscription(
        id:string
    ){

        return request(this.app)
            .post(
                `/subscriptions/${id}/cancel`
            );

    }



    async getSubscription(
        id:string
    ){

        return request(this.app)
            .get(
                `/subscriptions/${id}`
            );

    }

}