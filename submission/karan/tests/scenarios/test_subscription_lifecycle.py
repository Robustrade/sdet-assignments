from app.domain.states import SubscriptionStatus
from tests.framework.builders.subscription_builder import SubscriptionBuilder
from tests.framework.builders.webhook_builder import WebhookBuilder


def _create_with_invoice(api, repositories):
    created = api.create_subscription(SubscriptionBuilder().build())
    assert created.status_code == 201
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    return subscription, invoice


def _activate_subscription(api, repositories):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id="evt_activate").signed_success(subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    return subscription, invoice


def test_plan_specific_behavior_basic_starts_trial_without_immediate_charge(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder(plan="basic").build())

    assert created.status_code == 201
    subscription = created.json()
    assert subscription["status"] == "trialing"
    assert subscription["plan"] == "basic"
    assert repositories.invoices.for_subscription(subscription["id"]) == []
    assert provider.calls == []


def test_basic_trial_end_creates_first_billing_attempt_and_waits_for_webhook(
    api, repositories, provider, service, verify
):
    created = api.create_subscription(SubscriptionBuilder(plan="basic").build())
    subscription = created.json()

    provider.outcome = "succeeded"
    invoice = service.start_trial_billing(subscription["id"])

    assert invoice.amount == 2900
    assert invoice.currency == "USD"
    assert invoice.status == "pending"
    assert len(provider.calls) == 1
    verify.provider_charge_at(
        provider.calls,
        0,
        customer_id="cust_001",
        payment_method_id="pm_test_visa_4242",
        amount=2900,
        currency="USD",
        idempotency_key=invoice.id,
    )
    verify.subscription_status(subscription["id"], SubscriptionStatus.TRIALING)

    raw, signature = WebhookBuilder(event_id="evt_basic_trial_success").signed_success(
        subscription["id"], invoice.id, amount=2900
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], invoice.id)


def test_valid_subscription_creation(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())

    assert created.status_code == 201
    subscription = created.json()
    assert set(subscription) == {"id", "customer_id", "plan", "status"}
    assert subscription["status"] == "trialing"
    assert subscription["plan"] == "pro"
    verify.api_matches_persisted_subscription(subscription["id"], subscription)

    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    assert invoice.status == "pending"
    assert invoice.amount == 4900
    assert invoice.currency == "USD"
    assert repositories.payments.for_invoice(invoice.id) == []
    assert len(provider.calls) == 1


def test_signed_payment_succeeded_webhook_activates_subscription(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    provider_calls_before_webhook = len(provider.calls)

    raw, signature = WebhookBuilder().signed_success(subscription["id"], invoice.id)
    delivered = api.deliver_webhook(raw, signature)

    assert delivered.status_code == 200
    assert delivered.json() == {"processed": True}
    webhook = repositories.webhooks.for_subscription(subscription["id"])[0]
    assert webhook.event_id == "evt_success_001"
    assert webhook.type == "payment.succeeded"
    assert webhook.processed is True
    assert invoice.status == "paid"
    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], invoice.id)
    assert len(provider.calls) == provider_calls_before_webhook


def test_api_and_database_consistency_after_activation(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder().signed_success(subscription["id"], invoice.id)
    api.deliver_webhook(raw, signature)

    observed = api.get_subscription(subscription["id"])
    assert observed.status_code == 200
    verify.api_matches_persisted_subscription(subscription["id"], observed.json())
    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], invoice.id)


def test_audit_event_created_for_activation(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_success_001").signed_success(
        subscription["id"], invoice.id
    )
    api.deliver_webhook(raw, signature)

    verify.activated_by(subscription["id"], "evt_success_001")


def test_trial_payment_failure_moves_subscription_to_past_due(api, repositories, provider, service, verify):
    created = api.create_subscription(SubscriptionBuilder(plan="basic").build())
    subscription = created.json()
    provider.outcome = "declined"
    invoice = service.start_trial_billing(subscription["id"])
    provider_calls_before_webhook = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_failed").signed(
        "payment.failed", subscription["id"], invoice.id, amount=2900
    )

    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.PAST_DUE)
    verify.invoice_state(invoice, status="failed", amount=2900)
    verify.payment_statuses(invoice.id, ["failed"])
    verify.audit_transition(
        subscription["id"],
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.PAST_DUE,
        reference_id="evt_failed",
    )
    assert len(provider.calls) == provider_calls_before_webhook


def test_active_subscription_can_be_canceled(api, repositories, provider, verify):
    subscription, invoice = _activate_subscription(api, repositories)
    provider_calls_after_activation = len(provider.calls)

    response = api.cancel_subscription(subscription["id"])
    assert response.status_code == 200
    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    verify.has_successful_payment(subscription["id"], invoice.id)
    verify.audit_transition(
        subscription["id"],
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.CANCELED,
        reference_id=subscription["id"],
    )
    assert len(provider.calls) == provider_calls_after_activation


def test_canceling_a_canceled_subscription_is_rejected(api, repositories):
    subscription, _ = _create_with_invoice(api, repositories)
    assert api.cancel_subscription(subscription["id"]).status_code == 200

    assert api.cancel_subscription(subscription["id"]).status_code == 409
