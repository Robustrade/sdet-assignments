import { SubscriptionRepository } from "../../src/repositories/SubscriptionRepository";
import { SubscriptionBuilder } from "../../src/builders/SubscriptionBuilder";
import { db } from "../../src/database/database";

describe("Subscription Repository", () => {

    const repository = new SubscriptionRepository();

    it("should persist a subscription", () => {

        const subscription = new SubscriptionBuilder()
            .withId("sub_test_001")
            .build();

        repository.save(subscription);

        const row = db
            .prepare("SELECT * FROM subscriptions WHERE id = ?")
            .get(subscription.id);

        expect(row).toBeDefined();
        expect(row.id).toBe(subscription.id);
        expect(row.customer_id).toBe("cust_001");
        expect(row.plan).toBe("pro");
        expect(row.status).toBe("trialing");

    });

});