import request from "supertest";


export class WebhookSimulator {


    constructor(
        private app:any
    ){}



    async send(
        payload:any
    ){

        return request(this.app)
            .post(
                "/webhooks/payment-provider"
            )
            .send(payload);

    }

}