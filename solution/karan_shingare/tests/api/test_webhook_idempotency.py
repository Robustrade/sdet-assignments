from types import SimpleNamespace

import pytest

from utils.builders import SubscriptionRequestBuilder, WebhookPayloadBuilder

pytestmark = pytest.mark.webhook


def _create_trialing(api: SimpleNamespace, customer: dict) -> str:
    resp = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    )
    return resp.get_json()["id"]


def test_duplicate_event_id_transitions_the_subscription_exactly_once(
    api: SimpleNamespace, customer: dict, webhook_secret: str
) -> None:
    sub_id = _create_trialing(api, customer)
    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .with_event_id("evt_fixed_id").for_subscription(sub_id).build_signed_request(webhook_secret)

    first = api.webhooks.send(body, headers)
    second = api.webhooks.send(body, headers)

    assert first.get_json()["status"] == "processed"
    assert second.get_json()["status"] == "duplicate"
    assert api.subscriptions.get(sub_id).get_json()["status"] == "active"


def test_duplicate_event_id_does_not_create_a_duplicate_invoice(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace, webhook_secret: str
) -> None:
    sub_id = _create_trialing(api, customer)
    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .with_event_id("evt_fixed_id").for_subscription(sub_id).build_signed_request(webhook_secret)

    api.webhooks.send(body, headers)
    api.webhooks.send(body, headers)

    invoices = repos.invoices.list_for_subscription(sub_id)
    assert len(invoices) == 1


def test_duplicate_event_id_is_only_recorded_once_in_webhook_events(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace, webhook_secret: str
) -> None:
    sub_id = _create_trialing(api, customer)
    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .with_event_id("evt_fixed_id").for_subscription(sub_id).build_signed_request(webhook_secret)

    for _ in range(3):
        api.webhooks.send(body, headers)

    assert repos.webhook_events.count() == 1


def test_duplicate_event_id_does_not_change_the_audit_log_more_than_once(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace, webhook_secret: str
) -> None:
    sub_id = _create_trialing(api, customer)
    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .with_event_id("evt_fixed_id").for_subscription(sub_id).build_signed_request(webhook_secret)

    api.webhooks.send(body, headers)
    api.webhooks.send(body, headers)

    status_changes = [e for e in repos.audit.list_for(sub_id) if e["event_type"] == "status_changed"]
    assert len(status_changes) == 1
