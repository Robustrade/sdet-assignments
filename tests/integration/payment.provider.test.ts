import { TestEnvironment } from "../fixtures/TestEnvironment";


describe("Payment Provider Interaction", () => {


    let env: TestEnvironment;


    beforeEach(() => {

        env = new TestEnvironment();

        env.setup();

    });



    test("should use mock payment provider with correct charge details", async () => {


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



        expect(env.provider.getCallCount())
            .toBe(1);



        const chargeRequest =
            env.provider.getLastRequest();



        expect(chargeRequest)
            .toMatchObject({

                customerId:
                    "cust_001",

                paymentMethodId:
                    "pm_test_visa_4242"

            });


    });


});