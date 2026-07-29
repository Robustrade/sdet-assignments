import { TestEnvironment } from "../fixtures/TestEnvironment";


describe("Subscription Lifecycle State Machine", () => {


    let env: TestEnvironment;



    beforeEach(() => {

        env = new TestEnvironment();

        env.setup();

    });



    async function createSubscription() {


        const response =
            await env.api()
                .post("/subscriptions")
                .send({

                    customerId:
                        "cust_001",

                    plan:
                        "pro",

                    paymentMethodId:
                        "pm_test_visa_4242"

                });



        expect(response.status)
            .toBe(201);



        return response.body.id;

    }





    test("trialing -> active when payment succeeds", async () => {


        const subscriptionId =
            await createSubscription();



        const response =
            await env.api()
                .post("/webhooks/payment-provider")
                .send({

                    event_id:
                        "evt_trial_active",

                    type:
                        "payment.succeeded",

                    subscription_id:
                        subscriptionId,

                    invoice_id:
                        "inv_trial_active",

                    amount:
                        4900,

                    currency:
                        "USD"

                });



        expect(response.status)
            .toBe(200);



        expect(response.body.status)
            .toBe("active");



        const subscription =
            env.subscriptionRepository
                .findById(subscriptionId);



        expect(subscription)
            .toBeDefined();



        expect(subscription!.status)
            .toBe("active");

    });






    test("trialing -> past_due when payment fails", async () => {


        const subscriptionId =
            await createSubscription();



        const response =
            await env.api()
                .post("/webhooks/payment-provider")
                .send({

                    event_id:
                        "evt_trial_failed",

                    type:
                        "payment.failed",

                    subscription_id:
                        subscriptionId,

                    invoice_id:
                        "inv_failed",

                    amount:
                        4900,

                    currency:
                        "USD"

                });



        expect(response.status)
            .toBe(200);



        expect(response.body.status)
            .toBe("past_due");



        const subscription =
            env.subscriptionRepository
                .findById(subscriptionId);



        expect(subscription)
            .toBeDefined();



        expect(subscription!.status)
            .toBe("past_due");


    });






    test("active -> canceled using cancel API", async () => {


        const subscriptionId =
            await createSubscription();




        await env.api()
            .post("/webhooks/payment-provider")
            .send({

                event_id:
                    "evt_activate_cancel",

                type:
                    "payment.succeeded",

                subscription_id:
                    subscriptionId,

                invoice_id:
                    "inv_activate_cancel",

                amount:
                    4900,

                currency:
                    "USD"

            });





        const response =
            await env.api()
                .post(
                    `/subscriptions/${subscriptionId}/cancel`
                );



        expect(response.status)
            .toBe(200);



        expect(response.body.status)
            .toBe("canceled");



        const subscription =
            env.subscriptionRepository
                .findById(subscriptionId);



        expect(subscription)
            .toBeDefined();



        expect(subscription!.status)
            .toBe("canceled");


    });






    test("canceled subscription cannot become active again", async () => {


        const subscriptionId =
            await createSubscription();




        await env.api()
            .post(
                `/subscriptions/${subscriptionId}/cancel`
            );





        const response =
            await env.api()
                .post("/webhooks/payment-provider")
                .send({

                    event_id:
                        "evt_after_cancel",

                    type:
                        "payment.succeeded",

                    subscription_id:
                        subscriptionId,

                    invoice_id:
                        "inv_after_cancel",

                    amount:
                        4900,

                    currency:
                        "USD"

                });




        expect(response.status)
            .toBe(200);



        const subscription =
            env.subscriptionRepository
                .findById(subscriptionId);



        expect(subscription)
            .toBeDefined();



        expect(subscription!.status)
            .toBe("canceled");


    });






    test("late payment.failed webhook does not regress active subscription", async () => {


        const subscriptionId =
            await createSubscription();




        await env.api()
            .post("/webhooks/payment-provider")
            .send({

                event_id:
                    "evt_success_first",

                type:
                    "payment.succeeded",

                subscription_id:
                    subscriptionId,

                invoice_id:
                    "inv_same",

                amount:
                    4900,

                currency:
                    "USD"

            });





        await env.api()
            .post("/webhooks/payment-provider")
            .send({

                event_id:
                    "evt_failure_late",

                type:
                    "payment.failed",

                subscription_id:
                    subscriptionId,

                invoice_id:
                    "inv_same",

                amount:
                    4900,

                currency:
                    "USD"

            });





        const subscription =
            env.subscriptionRepository
                .findById(subscriptionId);



        expect(subscription)
            .toBeDefined();



        expect(subscription!.status)
            .toBe("active");


    });


});