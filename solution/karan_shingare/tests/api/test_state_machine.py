from types import SimpleNamespace

import pytest

from data.state_transitions import TransitionCase
from service.state_machine import next_status
from utils.builders import SubscriptionRequestBuilder, WebhookPayloadBuilder
from utils.data_driven import DataDrivenTestCase
from utils.fake_payment_provider import FakePaymentProvider

pytestmark = pytest.mark.state_machine


class TestStateMachineTransitionTable(DataDrivenTestCase):
    """Pure, data-driven coverage of the whole lifecycle table, no HTTP/DB
    involved. Loads every (status, event) row from
    vars/TestStateMachineTransitionTable.json in one go, since it's a flat
    matrix rather than a set of named business scenarios, and a loop over
    every row reads better here than one method per row would.

    See test_*_via_* below for the same transitions proven end to end
    through the real API.
    """

    def test_every_transition_matches_the_table(self) -> None:
        for key, row in self.data.items():
            case = TransitionCase(name=key, **row)
            actual = next_status(case.current_status, case.event_type, case.retries_exhausted)
            assert actual == case.expected_status, f"{case.name}: expected {case.expected_status}, got {actual}"


def _create(api: SimpleNamespace, customer: dict, plan: str) -> dict:
    resp = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan(plan).build()
    )
    return resp.get_json()


def _make_past_due(api: SimpleNamespace, provider: FakePaymentProvider, customer: dict) -> str:
    provider.queue_outcome("decline")
    sub = _create(api, customer, "pro")  # pro has no trial, charges immediately
    assert sub["status"] == "past_due"
    return sub["id"]


def test_trialing_to_active_via_first_charge_success(api: SimpleNamespace, customer: dict) -> None:
    sub = _create(api, customer, "basic")

    resp = api.subscriptions.charge(sub["id"])

    assert resp.get_json()["status"] == "active"


def test_trialing_to_past_due_via_first_charge_failure(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    provider.queue_outcome("decline")
    sub = _create(api, customer, "basic")

    resp = api.subscriptions.charge(sub["id"])

    assert resp.get_json()["status"] == "past_due"


def test_active_to_past_due_via_webhook_charge_failure(
    api: SimpleNamespace, customer: dict, webhook_secret: str
) -> None:
    sub = _create(api, customer, "pro")  # immediate charge, default outcome succeeds -> active
    assert sub["status"] == "active"

    body, headers = WebhookPayloadBuilder().of_type("payment.failed") \
        .for_subscription(sub["id"]).build_signed_request(webhook_secret)
    resp = api.webhooks.send(body, headers)

    assert resp.get_json()["subscription_status"] == "past_due"
    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "past_due"


def test_past_due_to_active_via_retry_success(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    sub_id = _make_past_due(api, provider, customer)

    resp = api.subscriptions.retry_charge(sub_id)

    assert resp.get_json()["status"] == "active"


def test_past_due_to_canceled_once_retries_are_exhausted(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    sub_id = _make_past_due(api, provider, customer)

    # MAX_RETRIES is 3: the first two retries keep it past_due, the third cancels it.
    for _ in range(2):
        provider.queue_outcome("decline")
        resp = api.subscriptions.retry_charge(sub_id)
        assert resp.get_json()["status"] == "past_due"

    provider.queue_outcome("decline")
    resp = api.subscriptions.retry_charge(sub_id)

    assert resp.get_json()["status"] == "canceled"


def test_active_to_canceled_via_api_cancel(api: SimpleNamespace, customer: dict) -> None:
    sub = _create(api, customer, "pro")
    assert sub["status"] == "active"

    resp = api.subscriptions.cancel(sub["id"])

    assert resp.get_json()["status"] == "canceled"


def test_trialing_to_canceled_via_api_cancel(api: SimpleNamespace, customer: dict) -> None:
    sub = _create(api, customer, "basic")

    resp = api.subscriptions.cancel(sub["id"])

    assert resp.get_json()["status"] == "canceled"


def test_canceled_subscription_ignores_payment_succeeded_webhook(
    api: SimpleNamespace, customer: dict, webhook_secret: str
) -> None:
    sub = _create(api, customer, "basic")
    api.subscriptions.cancel(sub["id"])

    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .for_subscription(sub["id"]).build_signed_request(webhook_secret)
    api.webhooks.send(body, headers)

    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "canceled"


def test_canceled_subscription_ignores_payment_failed_webhook(
    api: SimpleNamespace, customer: dict, webhook_secret: str
) -> None:
    sub = _create(api, customer, "basic")
    api.subscriptions.cancel(sub["id"])

    body, headers = WebhookPayloadBuilder().of_type("payment.failed") \
        .for_subscription(sub["id"]).build_signed_request(webhook_secret)
    api.webhooks.send(body, headers)

    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "canceled"


def test_late_payment_failed_after_succeeded_does_not_regress_active_subscription(
    api: SimpleNamespace, customer: dict, webhook_secret: str
) -> None:
    sub = _create(api, customer, "basic")
    invoice_id = "inv_shared_00001"

    succeeded_body, succeeded_headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .for_subscription(sub["id"]).for_invoice(invoice_id).build_signed_request(webhook_secret)
    api.webhooks.send(succeeded_body, succeeded_headers)
    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "active"

    # Same invoice, a stale "failed" notification arrives after the "succeeded" one.
    failed_body, failed_headers = WebhookPayloadBuilder().of_type("payment.failed") \
        .with_event_id("evt_late_failure").for_subscription(sub["id"]) \
        .for_invoice(invoice_id).build_signed_request(webhook_secret)
    resp = api.webhooks.send(failed_body, failed_headers)

    assert resp.get_json()["status"] == "stale"
    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "active"
