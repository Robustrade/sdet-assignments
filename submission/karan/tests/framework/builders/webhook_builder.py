from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass

from app.api.routes import WEBHOOK_SECRET


@dataclass
class WebhookBuilder:
    event_id: str = "evt_success_001"

    def signed(self, event_type: str, subscription_id: str, invoice_id: str, amount: int = 4900,
               **attributes: object) -> tuple[bytes, str]:
        payload = {"event_id": self.event_id, "type": event_type,
                   "subscription_id": subscription_id, "invoice_id": invoice_id,
                   "amount": amount, "currency": "USD"}
        payload.update(attributes)
        raw = json.dumps(payload, separators=(",", ":")).encode()
        signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        return raw, signature

    def signed_success(self, subscription_id: str, invoice_id: str, amount: int = 4900) -> tuple[bytes, str]:
        return self.signed("payment.succeeded", subscription_id, invoice_id, amount)

    @staticmethod
    def sign_raw(raw: bytes) -> str:
        return hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()

    def signed_missing(self, missing_field: str, event_type: str, subscription_id: str, invoice_id: str,
                       amount: int = 4900, **attributes: object) -> tuple[bytes, str]:
        payload: dict[str, object] = {
            "event_id": self.event_id,
            "type": event_type,
            "subscription_id": subscription_id,
            "invoice_id": invoice_id,
            "amount": amount,
            "currency": "USD",
        }
        payload.update(attributes)
        payload.pop(missing_field, None)
        raw = json.dumps(payload, separators=(",", ":")).encode()
        signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        return raw, signature
