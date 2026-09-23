import json
import uuid
from typing import Optional

from service.signature import sign


class CustomerBuilder:
    def __init__(self) -> None:
        self._id: str = f"cust_{uuid.uuid4().hex[:8]}"
        self._name: str = "Test Customer"

    def with_id(self, customer_id: str) -> "CustomerBuilder":
        self._id = customer_id
        return self

    def with_name(self, name: str) -> "CustomerBuilder":
        self._name = name
        return self

    def build(self) -> dict:
        return {"id": self._id, "name": self._name}


class SubscriptionRequestBuilder:
    """Builds the JSON body for POST /subscriptions."""

    def __init__(self) -> None:
        self._customer_id: str = "cust_001"
        self._plan: str = "pro"
        self._payment_method_id: Optional[str] = "pm_test_visa_4242"

    def for_customer(self, customer_id: str) -> "SubscriptionRequestBuilder":
        self._customer_id = customer_id
        return self

    def with_plan(self, plan: str) -> "SubscriptionRequestBuilder":
        self._plan = plan
        return self

    def with_payment_method(self, payment_method_id: Optional[str]) -> "SubscriptionRequestBuilder":
        self._payment_method_id = payment_method_id
        return self

    def build(self) -> dict:
        return {
            "customer_id": self._customer_id,
            "plan": self._plan,
            "payment_method_id": self._payment_method_id,
        }


class WebhookPayloadBuilder:
    """Builds inbound payment-provider webhook payloads, signed or not."""

    def __init__(self) -> None:
        self._event_id: str = f"evt_{uuid.uuid4().hex[:12]}"
        self._type: str = "payment.succeeded"
        self._subscription_id: Optional[str] = None
        self._invoice_id: str = f"inv_{uuid.uuid4().hex[:12]}"
        self._amount: int = 4900
        self._currency: str = "USD"

    def with_event_id(self, event_id: str) -> "WebhookPayloadBuilder":
        self._event_id = event_id
        return self

    def of_type(self, event_type: str) -> "WebhookPayloadBuilder":
        self._type = event_type
        return self

    def for_subscription(self, subscription_id: Optional[str]) -> "WebhookPayloadBuilder":
        self._subscription_id = subscription_id
        return self

    def for_invoice(self, invoice_id: str) -> "WebhookPayloadBuilder":
        self._invoice_id = invoice_id
        return self

    def with_amount(self, amount: int) -> "WebhookPayloadBuilder":
        self._amount = amount
        return self

    def build(self) -> dict:
        return {
            "event_id": self._event_id,
            "type": self._type,
            "subscription_id": self._subscription_id,
            "invoice_id": self._invoice_id,
            "amount": self._amount,
            "currency": self._currency,
        }

    def build_raw_body(self) -> bytes:
        return json.dumps(self.build()).encode()

    def build_signed_request(self, secret: str) -> tuple[bytes, dict]:
        body = self.build_raw_body()
        headers = {
            "Content-Type": "application/json",
            "X-Provider-Signature": sign(body, secret),
        }
        return body, headers

    def build_unsigned_request(self) -> tuple[bytes, dict]:
        body = self.build_raw_body()
        headers = {"Content-Type": "application/json"}
        return body, headers
