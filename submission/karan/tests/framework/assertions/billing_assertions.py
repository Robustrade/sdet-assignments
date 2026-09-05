from __future__ import annotations

from app.database import Repositories
from app.domain.models import Invoice
from app.domain.states import SubscriptionStatus
from app.providers.payment_provider import ChargeRequest, PaymentProvider


class BillingAssertions:
    def __init__(self, repositories: Repositories) -> None:
        self.repositories = repositories

    def subscription_status(self, subscription_id: str, expected: SubscriptionStatus) -> None:
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        assert subscription is not None
        assert subscription.status == expected

    def activated_by(self, subscription_id: str, event_id: str) -> None:
        audits = self.repositories.audits.for_subscription(subscription_id)
        assert len(audits) == 1
        assert audits[0].from_status == SubscriptionStatus.TRIALING
        assert audits[0].to_status == SubscriptionStatus.ACTIVE
        assert audits[0].reference_id == event_id

    def api_matches_persisted_subscription(self, subscription_id: str, api_body: dict[str, str]) -> None:
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        assert subscription is not None
        assert api_body == {
            "id": subscription.id,
            "customer_id": subscription.customer_id,
            "plan": subscription.plan,
            "status": subscription.status,
        }

    def has_successful_payment(self, subscription_id: str, invoice_id: str) -> None:
        payments = self.repositories.payments.for_invoice(invoice_id)
        succeeded = [payment for payment in payments if payment.status == "succeeded"]
        assert succeeded, "ACTIVE subscription requires at least one successful payment"
        assert all(payment.subscription_id == subscription_id for payment in succeeded)

    def provider_charged_once(self, calls: list[ChargeRequest], *, customer_id: str,
                              payment_method_id: str, amount: int, currency: str,
                              idempotency_key: str) -> None:
        assert len(calls) == 1
        call = calls[0]
        assert call.customer_id == customer_id
        assert call.payment_method_id == payment_method_id
        assert call.amount == amount
        assert call.currency == currency
        assert call.idempotency_key == idempotency_key

    def provider_charge_at(
        self,
        calls: list[ChargeRequest],
        index: int,
        *,
        customer_id: str,
        payment_method_id: str,
        amount: int,
        currency: str,
        idempotency_key: str,
    ) -> None:
        assert len(calls) > index
        call = calls[index]
        assert call.customer_id == customer_id
        assert call.payment_method_id == payment_method_id
        assert call.amount == amount
        assert call.currency == currency
        assert call.idempotency_key == idempotency_key

    def creation_rejected_without_side_effects(self, customer_id: str, provider: PaymentProvider) -> None:
        assert self.repositories.subscriptions.subscriptions_for(customer_id) == []
        assert provider.calls == []

    def webhook_rejected_without_side_effects(
        self,
        subscription_id: str,
        invoice: Invoice,
        provider: PaymentProvider,
        *,
        status: SubscriptionStatus,
        invoice_status: str,
        payment_count: int,
        audit_count: int,
        provider_calls: int,
        webhook_count: int = 0,
    ) -> None:
        self.subscription_status(subscription_id, status)
        assert invoice.status == invoice_status
        assert len(self.repositories.payments.for_invoice(invoice.id)) == payment_count
        assert len(self.repositories.audits.for_subscription(subscription_id)) == audit_count
        assert len(self.repositories.webhooks.for_subscription(subscription_id)) == webhook_count
        assert len(provider.calls) == provider_calls

    def audit_transition(
        self,
        subscription_id: str,
        from_status: SubscriptionStatus,
        to_status: SubscriptionStatus,
        *,
        reference_id: str | None = None,
    ) -> None:
        audits = self.repositories.audits.for_subscription(subscription_id)
        matching = [
            audit for audit in audits
            if audit.from_status == from_status and audit.to_status == to_status
        ]
        assert matching, f"Expected audit transition {from_status} -> {to_status}"
        if reference_id is not None:
            assert any(audit.reference_id == reference_id for audit in matching)

    def payment_statuses(self, invoice_id: str, expected: list[str]) -> None:
        payments = self.repositories.payments.for_invoice(invoice_id)
        assert [payment.status for payment in payments] == expected

    def invoice_state(
        self,
        invoice: Invoice,
        *,
        status: str,
        amount: int | None = None,
        currency: str | None = None,
    ) -> None:
        assert invoice.status == status
        if amount is not None:
            assert invoice.amount == amount
        if currency is not None:
            assert invoice.currency == currency

    def retry_pending_not_finalized(
        self,
        subscription_id: str,
        retry_invoice_id: str,
        original_invoice_id: str,
    ) -> None:
        retry_invoice = self.repositories.invoices.get(retry_invoice_id)
        assert retry_invoice is not None
        self.subscription_status(subscription_id, SubscriptionStatus.PAST_DUE)
        self.invoice_state(retry_invoice, status="pending")
        assert self.repositories.payments.for_invoice(retry_invoice_id) == []
        self.payment_statuses(original_invoice_id, ["failed"])
        audits = self.repositories.audits.for_subscription(subscription_id)
        assert not any(
            audit.from_status == SubscriptionStatus.PAST_DUE and audit.to_status == SubscriptionStatus.ACTIVE
            for audit in audits
        )
