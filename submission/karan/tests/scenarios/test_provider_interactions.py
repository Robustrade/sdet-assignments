from app.domain.states import SubscriptionStatus
from tests.framework.builders.subscription_builder import SubscriptionBuilder
from tests.framework.builders.webhook_builder import WebhookBuilder


def test_provider_decline_persists_failure_and_moves_subscription_to_past_due(api, repositories, provider, verify):
    provider.outcome = "declined"
    response = api.create_subscription(SubscriptionBuilder(plan="pro", payment_method_id="pm_test").build())

    assert response.status_code == 201
    subscription = response.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    verify.subscription_status(subscription["id"], SubscriptionStatus.PAST_DUE)
    verify.invoice_state(invoice, status="failed", amount=4900)
    verify.payment_statuses(invoice.id, ["failed"])
    verify.audit_transition(subscription["id"], SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE)
    verify.provider_charged_once(
        provider.calls,
        customer_id="cust_001",
        payment_method_id="pm_test",
        amount=4900,
        currency="USD",
        idempotency_key=invoice.id,
    )


def test_provider_timeout_keeps_a_durable_pending_billing_attempt(api, repositories, provider, verify):
    provider.outcome = "timeout"
    response = api.create_subscription(SubscriptionBuilder(payment_method_id="pm_test").build())

    assert response.status_code == 201
    subscription = response.json()
    verify.subscription_status(subscription["id"], SubscriptionStatus.TRIALING)
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    verify.invoice_state(invoice, status="pending")
    assert repositories.payments.for_invoice(invoice.id) == []
    assert len(provider.calls) == 1


def test_provider_call_arguments_and_idempotency_reference(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]

    verify.provider_charged_once(
        provider.calls,
        customer_id="cust_001",
        payment_method_id="pm_test_visa_4242",
        amount=4900,
        currency="USD",
        idempotency_key=invoice.id,
    )


def test_retry_provider_uses_distinct_idempotency_key(api, repositories, provider, service, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    original_invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_first_failure").signed(
        "payment.failed", subscription["id"], original_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    retry_invoice = service.retry_payment(subscription["id"])

    assert len(provider.calls) == 2
    verify.provider_charge_at(
        provider.calls,
        1,
        customer_id="cust_001",
        payment_method_id="pm_test_visa_4242",
        amount=4900,
        currency="USD",
        idempotency_key=retry_invoice.id,
    )
    assert retry_invoice.id != original_invoice.id
