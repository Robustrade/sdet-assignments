from app.providers.payment_provider import ChargeRequest, ChargeResult


class MockPaymentProvider:
    """Configurable provider double; no network calls are made."""

    def __init__(self, outcome: str = "pending") -> None:
        if outcome not in {"pending", "succeeded", "declined", "timeout"}:
            raise ValueError(f"Unsupported mock outcome: {outcome}")
        self.outcome = outcome
        self.calls: list[ChargeRequest] = []

    def charge(self, request: ChargeRequest) -> ChargeResult:
        self.calls.append(request)
        return ChargeResult(reference=f"provider_{len(self.calls)}", status=self.outcome)
