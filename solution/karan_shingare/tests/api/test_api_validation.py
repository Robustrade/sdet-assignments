from types import SimpleNamespace

import pytest

from api.runner import ApiRunner
from data.subscription_cases import SubscriptionCreationCase
from data.webhook_cases import WebhookRequestCase
from utils.builders import SubscriptionRequestBuilder
from utils.data_driven import DataDrivenTestCase
from utils.fake_payment_provider import FakePaymentProvider


class TestCreateSubscription(DataDrivenTestCase):
    """One method per scenario in vars/TestCreateSubscription.json.

    Each method name matches its JSON key exactly, so `self.case(...)`
    always knows which entry belongs to which test.
    """

    def _run(self, key: str, runner: ApiRunner, customer: dict, provider: FakePaymentProvider) -> dict:
        case = self.case(SubscriptionCreationCase, key)
        resp = runner.run_creation_case(case, default_customer_id=customer["id"])
        body = runner.validate(resp, case)
        if case.expected_provider_calls is not None:
            assert provider.call_count == case.expected_provider_calls
        return body

    def test_trial_plan_creates_trialing_subscription(
        self, runner: ApiRunner, customer: dict, provider: FakePaymentProvider
    ) -> None:
        body = self._run("trial_plan_creates_trialing_subscription", runner, customer, provider)
        assert body["customer_id"] == customer["id"]

    def test_unknown_plan_is_rejected(
        self, runner: ApiRunner, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("unknown_plan_is_rejected", runner, customer, provider)

    def test_missing_payment_method_is_rejected(
        self, runner: ApiRunner, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("missing_payment_method_is_rejected", runner, customer, provider)

    def test_unknown_customer_is_rejected(
        self, runner: ApiRunner, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("unknown_customer_is_rejected", runner, customer, provider)

    def test_invalid_payment_method_format_is_rejected(
        self, runner: ApiRunner, customer: dict, provider: FakePaymentProvider
    ) -> None:
        self._run("invalid_payment_method_format_is_rejected", runner, customer, provider)


def test_get_unknown_subscription_returns_404(api: SimpleNamespace) -> None:
    resp = api.subscriptions.get("sub_does_not_exist")

    assert resp.status_code == 404


def test_canceling_an_already_canceled_subscription_is_rejected(api: SimpleNamespace, customer: dict) -> None:
    sub_id = api.subscriptions.create(
        SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
    ).get_json()["id"]
    api.subscriptions.cancel(sub_id)

    resp = api.subscriptions.cancel(sub_id)

    assert resp.status_code == 409


class TestWebhookRequestHandling(DataDrivenTestCase):
    """One method per scenario in vars/TestWebhookRequestHandling.json.

    Covers the webhook envelope (signature, malformed body, missing
    fields), not webhook business logic, see test_state_machine.py and
    test_webhook_idempotency.py for that.
    """

    pytestmark = pytest.mark.webhook

    def _run(self, key: str, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str) -> None:
        case = self.case(WebhookRequestCase, key)
        sub_id = None
        if not case.malformed_json and not case.missing_fields:
            sub_id = api.subscriptions.create(
                SubscriptionRequestBuilder().for_customer(customer["id"]).with_plan("basic").build()
            ).get_json()["id"]

        resp = runner.run_webhook_case(case, secret=webhook_secret, subscription_id=sub_id)

        assert resp.status_code == case.expected_status

    def test_valid_signature_is_accepted(
        self, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str
    ) -> None:
        self._run("valid_signature_is_accepted", runner, api, customer, webhook_secret)

    def test_wrong_signature_is_rejected(
        self, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str
    ) -> None:
        self._run("wrong_signature_is_rejected", runner, api, customer, webhook_secret)

    def test_no_signature_is_rejected(
        self, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str
    ) -> None:
        self._run("no_signature_is_rejected", runner, api, customer, webhook_secret)

    def test_malformed_json_body_is_rejected(
        self, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str
    ) -> None:
        self._run("malformed_json_body_is_rejected", runner, api, customer, webhook_secret)

    def test_missing_required_fields_is_rejected(
        self, runner: ApiRunner, api: SimpleNamespace, customer: dict, webhook_secret: str
    ) -> None:
        self._run("missing_required_fields_is_rejected", runner, api, customer, webhook_secret)
