import { TestEnvironment } from "../fixtures/TestEnvironment";


describe("Subscription API Validation", () => {


    let env: TestEnvironment;


    beforeEach(() => {

        env = new TestEnvironment();

        env.setup();

    });



    test("should create a subscription successfully", async () => {


        const response =
            await env.apiClient.createSubscription({

                customerId:
                    "cust_001",

                plan:
                    "pro",

                paymentMethodId:
                    "pm_test_visa_4242"

            });



        expect(response.status)
            .toBe(201);



        expect(response.body)
            .toMatchObject({

                customerId:
                    "cust_001",

                plan:
                    "pro",

                status:
                    "trialing"

            });



        const savedSubscription =
            env.subscriptionRepository
            .findById(
                response.body.id
            );



        expect(savedSubscription)
            .toBeDefined();



        expect(savedSubscription?.status)
            .toBe("trialing");

    });


});