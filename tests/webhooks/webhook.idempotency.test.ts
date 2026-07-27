import { TestEnvironment } from "../fixtures/TestEnvironment";


describe("Webhook Idempotency", () => {


    let env: TestEnvironment;



    beforeEach(() => {

        env = new TestEnvironment();

        env.setup();

    });



    test("same payment.succeeded webhook should process only once", async () => {


        const createResponse =
            await env.api()
                .post("/subscriptions")
                .send({

                    customerId: "cust_001",

                    plan: "pro",

                    paymentMethodId:
                        "pm_test_visa_4242"

                });



        expect(createResponse.status)
            .toBe(201);



        const subscriptionId =
            createResponse.body.id;




        const webhookPayload = {

            event_id:
                "evt_duplicate_001",

            type:
                "payment.succeeded",

            subscription_id:
                subscriptionId,

            invoice_id:
                "inv_001",

            amount:
                4900,

            currency:
                "USD"

        };




        // First webhook delivery

        const first =
            await env.webhookSimulator.send(
                webhookPayload
            );


        console.log(
            "FIRST WEBHOOK RESPONSE:",
            first.status,
            first.body
        );


        expect(first.status)
            .toBe(200);




        // Duplicate webhook delivery

        const second =
            await env.webhookSimulator.send(
                webhookPayload
            );


        console.log(
            "SECOND WEBHOOK RESPONSE:",
            second.status,
            second.body
        );


        expect(second.status)
            .toBe(200);




        // Same event should only be persisted once

        expect(
            env.webhookEventRepository.count()
        )
        .toBe(1);




        // Invoice should only be created once

        const invoices =
            env.invoiceRepository
                .findBySubscription(
                    subscriptionId
                );


        expect(invoices.length)
            .toBe(1);



    });


});