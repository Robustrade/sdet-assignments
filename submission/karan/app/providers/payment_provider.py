from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ChargeRequest:
    customer_id: str
    payment_method_id: str
    amount: int
    currency: str
    idempotency_key: str


@dataclass(frozen=True)
class ChargeResult:
    reference: str
    status: str


class PaymentProvider(Protocol):
    def charge(self, request: ChargeRequest) -> ChargeResult: ...

