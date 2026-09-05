from app.domain.states import SubscriptionStatus
from tests.framework.builders.invoice_builder import open_renewal_invoice
from tests.framework.builders.subscription_builder import SubscriptionBuilder
from tests.framework.builders.webhook_builder import WebhookBuilder


def _create_with_invoice(api, repositories):
    created = api.create_subscription(SubscriptionBuilder().build())
    assert created.status_code == 201
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    return subscription, invoice


def _past_due_subscription(api, repositories, event_id: str = "evt_first_failure"):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id=event_id).signed("payment.failed", subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    return subscription, invoice


def _activate_subscription(api, repositories):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id="evt_activate").signed_success(subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    return subscription, invoice


def test_active_subscription_moves_to_past_due_on_recurring_failure(api, repositories, provider, verify):
    subscription, activation_invoice = _activate_subscription(api, repositories)
    provider_calls_after_activation = len(provider.calls)
    renewal_invoice = open_renewal_invoice(repositories, subscription["id"])

    raw, signature = WebhookBuilder(event_id="evt_recurring_failure").signed(
        "payment.failed", subscription["id"], renewal_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.PAST_DUE)
    verify.invoice_state(activation_invoice, status="paid")
    verify.payment_statuses(activation_invoice.id, ["succeeded"])
    verify.invoice_state(renewal_invoice, status="failed")
    verify.payment_statuses(renewal_invoice.id, ["failed"])
    verify.audit_transition(
        subscription["id"],
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE,
        reference_id="evt_recurring_failure",
    )
    assert len(provider.calls) == provider_calls_after_activation


def test_retry_payment_does_not_finalize_synchronously(api, repositories, provider, service, verify):
    for outcome in ("succeeded", "declined", "pending", "timeout"):
        provider.outcome = "pending"
        subscription, original_invoice = _past_due_subscription(
            api, repositories, event_id=f"evt_first_failure_{outcome}"
        )
        provider.outcome = outcome
        calls_before = len(provider.calls)

        retry_invoice = service.retry_payment(subscription["id"])

        assert len(provider.calls) == calls_before + 1
        verify.provider_charge_at(
            provider.calls,
            calls_before,
            customer_id="cust_001",
            payment_method_id="pm_test_visa_4242",
            amount=4900,
            currency="USD",
            idempotency_key=retry_invoice.id,
        )
        assert retry_invoice.id != original_invoice.id
        verify.retry_pending_not_finalized(subscription["id"], retry_invoice.id, original_invoice.id)


def test_retry_success_activates_subscription(api, repositories, provider, service, verify):
    subscription, original_invoice = _past_due_subscription(api, repositories)
    retry_invoice = service.retry_payment(subscription["id"])
    verify.retry_pending_not_finalized(subscription["id"], retry_invoice.id, original_invoice.id)
    calls_after_retry = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_retry_success").signed_success(
        subscription["id"], retry_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], retry_invoice.id)
    verify.payment_statuses(original_invoice.id, ["failed"])
    verify.payment_statuses(retry_invoice.id, ["succeeded"])
    verify.invoice_state(retry_invoice, status="paid")
    verify.audit_transition(
        subscription["id"],
        SubscriptionStatus.PAST_DUE,
        SubscriptionStatus.ACTIVE,
        reference_id="evt_retry_success",
    )
    assert len(provider.calls) == calls_after_retry


def test_retry_failure_keeps_subscription_past_due(api, repositories, provider, service, verify):
    subscription, original_invoice = _past_due_subscription(api, repositories)
    retry_invoice = service.retry_payment(subscription["id"])
    verify.retry_pending_not_finalized(subscription["id"], retry_invoice.id, original_invoice.id)

    raw, signature = WebhookBuilder(event_id="evt_retry_failed").signed(
        "payment.failed", subscription["id"], retry_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.PAST_DUE)
    verify.payment_statuses(original_invoice.id, ["failed"])
    verify.payment_statuses(retry_invoice.id, ["failed"])
    verify.invoice_state(retry_invoice, status="failed")
    audits = repositories.audits.for_subscription(subscription["id"])
    assert not any(
        audit.from_status == SubscriptionStatus.PAST_DUE and audit.to_status == SubscriptionStatus.ACTIVE
        for audit in audits
    )
    assert len(provider.calls) == 2


def test_retries_exhausted_cancels_a_past_due_subscription(api, repositories, provider, service, verify):
    subscription, invoice = _past_due_subscription(api, repositories)
    retry_invoice = service.retry_payment(subscription["id"])
    verify.retry_pending_not_finalized(subscription["id"], retry_invoice.id, invoice.id)

    raw, signature = WebhookBuilder(event_id="evt_retries_exhausted").signed(
        "payment.failed", subscription["id"], retry_invoice.id, retries_exhausted=True
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    verify.payment_statuses(invoice.id, ["failed"])
    verify.payment_statuses(retry_invoice.id, ["failed"])
    verify.audit_transition(
        subscription["id"],
        SubscriptionStatus.PAST_DUE,
        SubscriptionStatus.CANCELED,
        reference_id="evt_retries_exhausted",
    )
    assert len(provider.calls) == 2


def test_retry_payment_is_rejected_for_active_subscription(api, repositories, provider, service, verify):
    subscription, invoice = _activate_subscription(api, repositories)
    calls_before = len(provider.calls)
    payment_count_before = len(repositories.payments.for_invoice(invoice.id))

    try:
        service.retry_payment(subscription["id"])
        raise AssertionError("Expected retry to be rejected")
    except ValueError as exc:
        assert "past due" in str(exc).lower()

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    assert len(provider.calls) == calls_before
    assert len(repositories.payments.for_invoice(invoice.id)) == payment_count_before


def test_retry_payment_is_rejected_for_canceled_subscription(api, repositories, provider, service, verify):
    subscription, invoice = _create_with_invoice(api, repositories)
    assert api.cancel_subscription(subscription["id"]).status_code == 200
    calls_before = len(provider.calls)

    try:
        service.retry_payment(subscription["id"])
        raise AssertionError("Expected retry to be rejected")
    except ValueError as exc:
        assert "past due" in str(exc).lower()

    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    assert len(provider.calls) == calls_before
    assert repositories.payments.for_invoice(invoice.id) == []
