from types import SimpleNamespace

import pytest

from data.provider_cases import ProviderCallCountCase
from utils.builders import SubscriptionRequestBuilder, WebhookPayloadBuilder
from utils.data_driven import DataDrivenTestCase
from utils.fake_payment_provider import FakePaymentProvider

pytestmark = pytest.mark.provider


class TestProviderCallCountByPlan(DataDrivenTestCase):
    """One method per scenario in vars/TestProviderCallCountByPlan.json.

    Richer per-call assertions (call arguments, decline/timeout handling)
    stay below as their own dedicated tests, since a call count alone
    doesn't capture what those verify.
    """

    def _run(self, key: str, api: SimpleNamespace, customer: dict, provider: FakePaymentProvider) -> None:
        case = self.case(ProviderCallCountCase, key)
        api.subscriptions.create(
            SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan(case.plan).build()
        )

        assert provider.call_count == case.expected_call_count

    def test_trial_plan_defers_the_charge(
        self, api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("trial_plan_defers_the_charge", api, customer, provider)

    def test_unknown_plan_never_reaches_the_provider(
        self, api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("unknown_plan_never_reaches_the_provider", api, customer, provider)


def test_provider_called_with_correct_arguments_on_immediate_charge_plan(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"])
        .with_plan("pro").with_payment_method("pm_test_visa_4242").build()
    )

    assert provider.call_count == 1
    call = provider.last_call()
    assert call.customer_id == customer["id"]
    assert call.amount == 4900
    assert call.currency == "USD"
    assert call.payment_method_id == "pm_test_visa_4242"
    assert call.idempotency_key is not None


def test_provider_not_called_when_a_webhook_is_replayed(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider, webhook_secret: str
) -> None:
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    ).get_json()["id"]
    body, headers = WebhookPayloadBuilder().of_type("payment.succeeded") \
        .with_event_id("evt_replay_test").for_subscription(sub_id).build_signed_request(webhook_secret)

    api.webhooks.send(body, headers)
    api.webhooks.send(body, headers)

    assert provider.call_count == 0


def test_provider_called_exactly_once_per_billing_attempt(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    provider.queue_outcome("decline")
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    ).get_json()["id"]  # attempt 1
    provider.queue_outcome("success")
    api.subscriptions.retry_charge(sub_id)  # attempt 2

    assert provider.call_count == 2


def test_provider_decline_moves_subscription_to_past_due(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    provider.queue_outcome("decline")

    resp = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    )

    assert resp.get_json()["status"] == "past_due"


def test_provider_timeout_is_treated_as_a_failed_charge(
    api: SimpleNamespace, customer: dict, provider: FakePaymentProvider
) -> None:
    provider.queue_outcome("timeout")

    resp = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("pro").build()
    )

    assert resp.get_json()["status"] == "past_due"
