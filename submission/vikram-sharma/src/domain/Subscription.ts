import { SubscriptionStatus } from "./SubscriptionStatus";

export class Subscription {

    constructor(
        public id: string,
        public customerId: string,
        public plan: string,
        public paymentMethodId: string,
        public status: SubscriptionStatus
    ) {}

}