from types import SimpleNamespace

from db.queries import status_history
from utils.builders import SubscriptionRequestBuilder, WebhookPayloadBuilder
from utils.fake_payment_provider import FakePaymentProvider


def test_full_lifecycle_trial_active_past_due_active_canceled(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, repos: SimpleNamespace, webhook_secret: str
) -> None:
    # trialing
    sub = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    ).get_json()
    assert sub["status"] == "trialing"
    assert provider.call_count == 0

    # trialing -> active: trial ends, first charge succeeds
    sub = api.subscriptions.charge(sub["id"]).get_json()
    assert sub["status"] == "active"
    assert provider.call_count == 1

    # active -> past_due: a later recurring charge fails, reported via webhook
    body, headers = WebhookPayloadBuilder().of_type("payment.failed") \
        .for_subscription(sub["id"]).build_signed_request(webhook_secret)
    api.webhooks.send(body, headers)
    assert api.subscriptions.get(sub["id"]).get_json()["status"] == "past_due"
    assert provider.call_count == 1  # webhooks never call the provider

    # past_due -> active: retry succeeds
    sub = api.subscriptions.retry_charge(sub["id"]).get_json()
    assert sub["status"] == "active"
    assert provider.call_count == 2

    # active -> canceled
    sub = api.subscriptions.cancel(sub["id"]).get_json()
    assert sub["status"] == "canceled"

    final = api.subscriptions.get(sub["id"]).get_json()
    assert final == repos.subscriptions.get(sub["id"]).to_dict()
    assert status_history(repos, sub["id"])[-1] == "canceled"


def test_trial_end_can_be_driven_by_a_webhook_alone(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, repos: SimpleNamespace, webhook_secret: str
) -> None:
    """Models the payment provider running its own billing schedule for a
    trialing subscription and notifying us purely via webhook, with no
    synchronous charge call made by our service."""
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    ).get_json()["id"]

    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .for_subscription(sub_id).build_signed_request(webhook_secret)
    resp = api.webhooks.send(body, headers)

    assert resp.get_json()["status"] == "processed"
    assert api.subscriptions.get(sub_id).get_json()["status"] == "active"
    assert provider.call_count == 0
    assert len(repos.invoices.list_for_subscription(sub_id)) == 1
