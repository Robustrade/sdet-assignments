from app.domain.states import SubscriptionStatus
from tests.framework.builders.subscription_builder import SubscriptionBuilder
from tests.framework.builders.webhook_builder import WebhookBuilder


def test_unknown_customer_is_rejected_without_side_effects(api, repositories, provider, verify):
    response = api.create_subscription(
        SubscriptionBuilder(customer_id="cust_unknown", payment_method_id="pm_test").build()
    )

    assert response.status_code == 422
    assert "detail" in response.json()
    verify.creation_rejected_without_side_effects("cust_unknown", provider)


def test_unknown_plan_is_rejected_without_side_effects(api, repositories, provider, verify):
    response = api.create_subscription(SubscriptionBuilder(plan="enterprise", payment_method_id="pm_test").build())

    assert response.status_code == 422
    assert "detail" in response.json()
    verify.creation_rejected_without_side_effects("cust_001", provider)


def test_missing_payment_method_is_rejected_without_side_effects(api, repositories, provider, verify):
    response = api.create_subscription({"customer_id": "cust_001", "plan": "pro"})

    assert response.status_code == 422
    assert "detail" in response.json()
    verify.creation_rejected_without_side_effects("cust_001", provider)


def test_invalid_payment_method_is_rejected_without_side_effects(api, repositories, provider, verify):
    response = api.create_subscription(SubscriptionBuilder(payment_method_id="").build())

    assert response.status_code == 422
    assert "detail" in response.json()
    verify.creation_rejected_without_side_effects("cust_001", provider)


def test_get_unknown_subscription_returns_not_found(api, provider):
    response = api.get_subscription("sub_does_not_exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Subscription not found"}
    assert provider.calls == []


def test_malformed_webhook_is_rejected_without_side_effects(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw = b"not-valid-json"
    signature = WebhookBuilder.sign_raw(raw)

    response = api.deliver_webhook(raw, signature)

    assert response.status_code == 422
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )


def test_webhook_missing_required_field_is_rejected(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_missing_field").signed_missing(
        "event_id", "payment.succeeded", subscription["id"], invoice.id
    )

    response = api.deliver_webhook(raw, signature)

    assert response.status_code == 422
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )


def test_unsupported_webhook_type_is_rejected(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_unsupported").signed(
        "payment.unknown", subscription["id"], invoice.id
    )

    response = api.deliver_webhook(raw, signature)

    assert response.status_code == 422
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )


def test_webhook_currency_mismatch_is_rejected(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_wrong_currency").signed(
        "payment.succeeded", subscription["id"], invoice.id, currency="EUR"
    )

    response = api.deliver_webhook(raw, signature)

    assert response.status_code == 422
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )


def test_invalid_webhook_signature_is_rejected_without_side_effects(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, _ = WebhookBuilder(event_id="evt_forged").signed_success(subscription["id"], invoice.id)

    response = api.deliver_webhook(raw, "forged")

    assert response.status_code == 401
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )


def test_webhook_amount_mismatch_is_rejected(api, repositories, provider, verify):
    created = api.create_subscription(SubscriptionBuilder().build())
    subscription = created.json()
    invoice = repositories.invoices.for_subscription(subscription["id"])[0]
    raw, signature = WebhookBuilder(event_id="evt_wrong_amount").signed_success(
        subscription["id"], invoice.id, amount=1
    )

    response = api.deliver_webhook(raw, signature)

    assert response.status_code == 422
    verify.webhook_rejected_without_side_effects(
        subscription["id"],
        invoice,
        provider,
        status=SubscriptionStatus.TRIALING,
        invoice_status="pending",
        payment_count=0,
        audit_count=0,
        provider_calls=1,
    )
