from dataclasses import dataclass

from app.domain.models import Customer


@dataclass
class CustomerBuilder:
    customer_id: str = "cust_001"
    name: str = "Ada Lovelace"
    email: str = "ada@example.test"

    def build(self) -> Customer:
        return Customer(id=self.customer_id, name=self.name, email=self.email)
