import uuid
from collections import deque
from typing import Optional
from types import SimpleNamespace

from service.payment_provider import PaymentProvider, ChargeResult, ProviderDecline, ProviderTimeout


class FakePaymentProvider(PaymentProvider):
    """Test double for the external payment provider.

    Records every call for later assertions and lets a test queue up
    per-call outcomes (e.g. decline once, then succeed on retry) instead of
    only supporting one fixed outcome for the whole test.
    """

    def __init__(self, default_outcome: str = "success") -> None:
        self.calls: list[SimpleNamespace] = []
        self._default_outcome = default_outcome
        self._queued_outcomes: deque[tuple[str, str]] = deque()

    def queue_outcome(self, outcome: str, decline_reason: str = "card_declined") -> "FakePaymentProvider":
        self._queued_outcomes.append((outcome, decline_reason))
        return self

    def charge(
        self, *, customer_id: str, amount: int, currency: str, payment_method_id: str, idempotency_key: str
    ) -> ChargeResult:
        outcome, decline_reason = self._queued_outcomes.popleft() if self._queued_outcomes \
            else (self._default_outcome, "card_declined")

        self.calls.append(SimpleNamespace(
            customer_id=customer_id, amount=amount, currency=currency,
            payment_method_id=payment_method_id, idempotency_key=idempotency_key,
        ))

        if outcome == "timeout":
            raise ProviderTimeout("provider did not respond in time")
        if outcome == "decline":
            raise ProviderDecline(decline_reason)
        return ChargeResult(provider_reference=f"ch_{uuid.uuid4().hex[:12]}")

    @property
    def call_count(self) -> int:
        return len(self.calls)

    def last_call(self) -> Optional[SimpleNamespace]:
        return self.calls[-1] if self.calls else None
