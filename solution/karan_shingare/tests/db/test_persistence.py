from types import SimpleNamespace

import pytest

from db.queries import has_paid_invoice, invoice_statuses, status_history
from utils.builders import SubscriptionRequestBuilder
from utils.fake_payment_provider import FakePaymentProvider

pytestmark = pytest.mark.persistence


def test_persisted_subscription_matches_api_response_on_creation(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace
) -> None:
    resp = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    )
    body = resp.get_json()

    db_sub = repos.subscriptions.get(body["id"])

    assert db_sub.status == body["status"] == "trialing"
    assert db_sub.plan == "basic"
    assert db_sub.customer_id == customer["id"]


def test_rejected_creation_persists_no_subscription_row(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace
) -> None:
    api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("not_a_real_plan").build()
    )

    assert repos.subscriptions.count() == 0


def test_invoice_written_for_each_real_billing_attempt(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, repos: SimpleNamespace
) -> None:
    provider.queue_outcome("decline")
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    ).get_json()["id"]  # attempt 1: fails
    provider.queue_outcome("success")
    api.subscriptions.retry_charge(sub_id)  # attempt 2: succeeds

    assert invoice_statuses(repos, sub_id) == ["failed", "paid"]


def test_failed_charge_never_creates_a_paid_invoice(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, repos: SimpleNamespace
) -> None:
    provider.queue_outcome("decline")
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    ).get_json()["id"]

    assert "paid" not in invoice_statuses(repos, sub_id)


def test_active_subscription_always_has_a_paid_invoice_on_record(
    api: SimpleNamespace, customer: dict, repos: SimpleNamespace
) -> None:
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    ).get_json()["id"]

    assert api.subscriptions.get(sub_id).get_json()["status"] == "active"
    assert has_paid_invoice(repos, sub_id)


def test_audit_log_tracks_the_full_lifecycle_and_agrees_with_final_status(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, repos: SimpleNamespace
) -> None:
    provider.queue_outcome("decline")
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    ).get_json()["id"]
    provider.queue_outcome("success")
    api.subscriptions.retry_charge(sub_id)
    api.subscriptions.cancel(sub_id)

    history = status_history(repos, sub_id)

    assert history == ["trialing", "past_due", "active", "canceled"]
    assert repos.subscriptions.get(sub_id).status == history[-1]
