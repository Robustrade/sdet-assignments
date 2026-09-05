from dataclasses import dataclass


@dataclass
class SubscriptionBuilder:
    customer_id: str = "cust_001"
    plan: str = "pro"
    payment_method_id: str = "pm_test_visa_4242"

    def build(self) -> dict[str, str]:
        return {"customer_id": self.customer_id, "plan": self.plan,
                "payment_method_id": self.payment_method_id}
