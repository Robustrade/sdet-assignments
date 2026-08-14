import { Subscription } from "../domain/Subscription";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";

export class SubscriptionBuilder {

    private id = "sub_001";
    private customerId = "cust_001";
    private plan = "pro";
    private paymentMethodId = "pm_test_visa_4242";
    private status = SubscriptionStatus.TRIALING;

    withId(id: string): SubscriptionBuilder {
        this.id = id;
        return this;
    }

    withCustomer(customerId: string): SubscriptionBuilder {
        this.customerId = customerId;
        return this;
    }

    withPlan(plan: string): SubscriptionBuilder {
        this.plan = plan;
        return this;
    }

    withPaymentMethod(paymentMethodId: string): SubscriptionBuilder {
        this.paymentMethodId = paymentMethodId;
        return this;
    }

    withStatus(status: SubscriptionStatus): SubscriptionBuilder {
        this.status = status;
        return this;
    }

    build(): Subscription {

        return new Subscription(
            this.id,
            this.customerId,
            this.plan,
            this.paymentMethodId,
            this.status
        );

    }

}
 