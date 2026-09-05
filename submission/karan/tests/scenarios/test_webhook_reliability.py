from app.domain.states import SubscriptionStatus
from tests.framework.builders.subscription_builder import SubscriptionBuilder
from tests.framework.builders.webhook_builder import WebhookBuilder


def _create_with_invoice(api, repositories):
    response = api.create_subscription(SubscriptionBuilder().build())
    assert response.status_code == 201
    subscription = response.json()
    return subscription, repositories.invoices.for_subscription(subscription["id"])[0]


def _activate_subscription(api, repositories):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id="evt_activate").signed_success(subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    return subscription, invoice


def _past_due_with_retry(api, repositories, provider, service):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id="evt_first_failure").signed("payment.failed", subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    retry_invoice = service.retry_payment(subscription["id"])
    return subscription, invoice, retry_invoice


def test_duplicate_success_webhook_is_recorded_once_and_has_no_duplicate_side_effects(api, repositories, provider, verify):
    subscription, invoice = _create_with_invoice(api, repositories)
    provider_calls_before = len(provider.calls)
    raw, signature = WebhookBuilder(event_id="evt_duplicate").signed_success(subscription["id"], invoice.id)

    assert api.deliver_webhook(raw, signature).json() == {"processed": True}
    assert api.deliver_webhook(raw, signature).json() == {"processed": False}

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], invoice.id)
    assert len(repositories.webhooks.for_subscription(subscription["id"])) == 1
    assert len(repositories.payments.for_invoice(invoice.id)) == 1
    assert len(repositories.audits.for_subscription(subscription["id"])) == 1
    assert len(provider.calls) == provider_calls_before


def test_late_failure_for_a_paid_invoice_does_not_regress_active_subscription(api, repositories, provider, verify):
    subscription, invoice = _create_with_invoice(api, repositories)
    raw, signature = WebhookBuilder(event_id="evt_success").signed_success(subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200
    provider_calls_after_success = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_late_failure").signed("payment.failed", subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], invoice.id)
    verify.invoice_state(invoice, status="paid")
    assert len(repositories.payments.for_invoice(invoice.id)) == 1
    assert len(provider.calls) == provider_calls_after_success


def test_canceled_subscription_is_terminal_when_a_success_webhook_arrives(api, repositories, provider, verify):
    subscription, invoice = _create_with_invoice(api, repositories)
    assert api.cancel_subscription(subscription["id"]).status_code == 200
    provider_calls_before = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_after_cancel").signed_success(subscription["id"], invoice.id)
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    assert repositories.payments.for_invoice(invoice.id) == []
    assert len(repositories.audits.for_subscription(subscription["id"])) == 1
    assert len(provider.calls) == provider_calls_before


def test_canceled_remains_terminal_after_late_failure(api, repositories, provider, verify):
    subscription, invoice = _activate_subscription(api, repositories)
    assert api.cancel_subscription(subscription["id"]).status_code == 200
    provider_calls_before = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_late_fail_canceled").signed(
        "payment.failed", subscription["id"], invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    verify.invoice_state(invoice, status="paid")
    verify.has_successful_payment(subscription["id"], invoice.id)
    assert len(provider.calls) == provider_calls_before


def test_canceled_remains_terminal_after_refund(api, repositories, provider, verify):
    subscription, invoice = _activate_subscription(api, repositories)
    assert api.cancel_subscription(subscription["id"]).status_code == 200
    provider_calls_before = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_refund_canceled").signed(
        "payment.refunded", subscription["id"], invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.CANCELED)
    audits = repositories.audits.for_subscription(subscription["id"])
    assert len(audits) == 3
    refund_audit = next(audit for audit in audits if audit.event_type == "payment.refunded")
    assert refund_audit.from_status == refund_audit.to_status == SubscriptionStatus.CANCELED
    assert len(provider.calls) == provider_calls_before


def test_refund_is_audited_without_inventing_a_subscription_transition(api, repositories, provider, verify):
    subscription, invoice = _create_with_invoice(api, repositories)
    provider_calls_before = len(provider.calls)
    raw, signature = WebhookBuilder(event_id="evt_refund").signed("payment.refunded", subscription["id"], invoice.id)

    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.TRIALING)
    audit = repositories.audits.for_subscription(subscription["id"])[0]
    assert audit.event_type == "payment.refunded"
    assert audit.from_status == audit.to_status == SubscriptionStatus.TRIALING
    assert len(provider.calls) == provider_calls_before


def test_duplicate_retry_success_webhook_does_not_charge_provider(api, repositories, provider, service, verify):
    subscription, original_invoice, retry_invoice = _past_due_with_retry(api, repositories, provider, service)
    calls_after_retry = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_retry_dup").signed_success(
        subscription["id"], retry_invoice.id
    )
    assert api.deliver_webhook(raw, signature).json() == {"processed": True}
    assert api.deliver_webhook(raw, signature).json() == {"processed": False}

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.has_successful_payment(subscription["id"], retry_invoice.id)
    verify.payment_statuses(original_invoice.id, ["failed"])
    verify.payment_statuses(retry_invoice.id, ["succeeded"])
    assert len(repositories.audits.for_subscription(subscription["id"])) == 2
    assert len(provider.calls) == calls_after_retry


def test_late_failure_after_retry_success_does_not_regress_active(api, repositories, provider, service, verify):
    subscription, original_invoice, retry_invoice = _past_due_with_retry(api, repositories, provider, service)

    raw, signature = WebhookBuilder(event_id="evt_retry_success").signed_success(
        subscription["id"], retry_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200
    calls_after_retry = len(provider.calls)

    raw, signature = WebhookBuilder(event_id="evt_late_fail_after_retry").signed(
        "payment.failed", subscription["id"], retry_invoice.id
    )
    assert api.deliver_webhook(raw, signature).status_code == 200

    verify.subscription_status(subscription["id"], SubscriptionStatus.ACTIVE)
    verify.invoice_state(retry_invoice, status="paid")
    verify.has_successful_payment(subscription["id"], retry_invoice.id)
    verify.payment_statuses(original_invoice.id, ["failed"])
    assert len(provider.calls) == calls_after_retry
