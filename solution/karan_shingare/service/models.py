from dataclasses import dataclass, asdict
from typing import Optional


@dataclass
class Subscription:
    id: str
    customer_id: str
    plan: str
    status: str
    payment_method_id: str
    trial_end: Optional[str]
    created_at: str
    canceled_at: Optional[str]
    retry_count: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Invoice:
    id: str
    subscription_id: str
    amount: int
    currency: str
    status: str
    provider_reference: Optional[str]
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)
