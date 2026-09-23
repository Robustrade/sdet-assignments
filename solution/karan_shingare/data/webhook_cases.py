"""Schema for POST /webhooks/payment-provider request-handling cases.

Values live as JSON in tests/api/vars/TestWebhookRequestHandling.json.
Covers signature verification, malformed bodies, and missing fields, the
webhook *envelope* checks. Business-logic behavior (idempotency, out of
order delivery) lives in test_webhook_idempotency.py and
test_state_machine.py instead, since it depends on service state, not just
the request shape, and isn't a clean fit for this same case shape.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class WebhookRequestCase:
    name: str
    event_type: str = "payment.succeeded"
    signed: bool = True
    secret_override: Optional[str] = None  # None => sign with the correct secret
    malformed_json: bool = False
    missing_fields: bool = False
    expected_status: int = 200
