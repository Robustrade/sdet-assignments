from abc import ABC, abstractmethod
from dataclasses import dataclass


class ProviderError(Exception):
    """Base class for anything the payment provider can throw at us."""


class ProviderDecline(ProviderError):
    def __init__(self, reason: str = "card_declined") -> None:
        super().__init__(reason)
        self.reason = reason


class ProviderTimeout(ProviderError):
    pass


@dataclass
class ChargeResult:
    provider_reference: str


class PaymentProvider(ABC):
    """Seam between the billing service and the external payment provider.

    Production code would implement this against the real gateway's SDK;
    tests substitute a fake so we never make a network call. Nothing in
    service/ imports a concrete implementation, only this interface.
    """

    @abstractmethod
    def charge(
        self, *, customer_id: str, amount: int, currency: str, payment_method_id: str, idempotency_key: str
    ) -> ChargeResult:
        raise NotImplementedError
