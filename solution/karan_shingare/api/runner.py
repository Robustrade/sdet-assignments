"""Generic, reusable request runner + validator for data-driven API tests.

Keeps *how* to turn a case into a request and check the response (this file)
separate from *what* to send and *what* to expect (data/*.py) - a new test
scenario is a new data row, never new test code.
"""
import json
from typing import Optional, Protocol

from werkzeug.test import TestResponse

from data.subscription_cases import SubscriptionCreationCase
from data.webhook_cases import WebhookRequestCase
from service.signature import sign
from utils.builders import SubscriptionRequestBuilder, WebhookPayloadBuilder


class _SubscriptionsEndpointLike(Protocol):
    def create(self, payload: dict) -> TestResponse: ...


class _WebhooksEndpointLike(Protocol):
    def send(self, raw_body: bytes, headers: dict) -> TestResponse: ...


class _ApiLike(Protocol):
    subscriptions: _SubscriptionsEndpointLike
    webhooks: _WebhooksEndpointLike


class ApiRunner:
    def __init__(self, api: _ApiLike) -> None:
        self._api = api

    def run_creation_case(self, case: SubscriptionCreationCase, default_customer_id: str) -> TestResponse:
        payload = SubscriptionRequestBuilder() \
            .for_customer(case.customer_id or default_customer_id) \
            .with_plan(case.plan) \
            .with_payment_method(case.payment_method_id) \
            .build()
        return self._api.subscriptions.create(payload)

    def run_webhook_case(
        self, case: WebhookRequestCase, secret: str, subscription_id: Optional[str] = None
    ) -> TestResponse:
        if case.malformed_json:
            raw_body = b"{not valid json"
            headers = {"X-Provider-Signature": sign(raw_body, secret)}
        elif case.missing_fields:
            raw_body = json.dumps({"type": case.event_type}).encode()
            headers = {"X-Provider-Signature": sign(raw_body, secret)}
        else:
            builder = WebhookPayloadBuilder().of_type(case.event_type).for_subscription(subscription_id)
            if case.signed:
                raw_body, headers = builder.build_signed_request(case.secret_override or secret)
            else:
                raw_body, headers = builder.build_unsigned_request()
        return self._api.webhooks.send(raw_body, headers)

    @staticmethod
    def validate(resp: TestResponse, case: SubscriptionCreationCase) -> dict:
        assert resp.status_code == case.expected_status, (
            f"{case.name}: expected status {case.expected_status}, got {resp.status_code} "
            f"({resp.get_data(as_text=True)})"
        )
        body = resp.get_json(silent=True) or {}
        for key, expected in (case.expected_body or {}).items():
            assert body.get(key) == expected, (
                f"{case.name}: field '{key}' expected {expected!r}, got {body.get(key)!r}"
            )
        if case.expected_error_contains:
            assert case.expected_error_contains in body.get("error", ""), (
                f"{case.name}: expected error to mention '{case.expected_error_contains}', "
                f"got {body.get('error')!r}"
            )
        return body
