from __future__ import annotations

import json

from app.database import Repositories
from app.domain.models import AuditEvent, Invoice, Payment, Plan, PlanCatalog, Subscription, WebhookEvent
from app.domain.state_machine import SubscriptionStateMachine
from app.domain.states import LifecycleEvent, SubscriptionStatus
from app.providers.payment_provider import ChargeRequest, PaymentProvider


class NotFoundError(ValueError):
    pass


class SubscriptionService:
    def __init__(self, repositories: Repositories, provider: PaymentProvider) -> None:
        self.repositories = repositories
        self.provider = provider
        self.plans = PlanCatalog()
        self.state_machine = SubscriptionStateMachine()

    def create_subscription(self, customer_id: str, plan_code: str, payment_method_id: str) -> Subscription:
        if not payment_method_id:
            raise ValueError("payment_method_id is required")
        if not self.repositories.subscriptions.find_customer(customer_id):
            raise NotFoundError("Unknown customer")
        plan = self.plans.get(plan_code)
        subscription = Subscription(
            customer_id=customer_id,
            plan=plan.code,
            payment_method_id=payment_method_id,
            status=SubscriptionStatus.TRIALING,
        )
        self.repositories.subscriptions.add_subscription(subscription)
        self.repositories.session.flush()

        # Trial plans wait until trial end before creating the first billing attempt.
        # No provider call or invoice is created during subscription creation.
        if plan.trial_days == 0:
            self._start_billing_attempt(subscription, plan, attempt_number=1, await_webhook=False)

        self.repositories.session.commit()
        return subscription

    def cancel(self, subscription_id: str) -> Subscription:
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        if not subscription:
            raise NotFoundError("Unknown subscription")
        self._transition(subscription, LifecycleEvent.CANCEL, subscription_id)
        self.repositories.session.commit()
        return subscription

    def start_trial_billing(self, subscription_id: str) -> Invoice:
        """Start the first charge when a trial ends; the webhook finalizes its outcome."""
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        if not subscription:
            raise NotFoundError("Unknown subscription")
        if subscription.status != SubscriptionStatus.TRIALING:
            raise ValueError("Trial billing is only allowed for trialing subscriptions")
        plan = self.plans.get(subscription.plan)
        if plan.trial_days == 0:
            raise ValueError("Plan does not have a trial")
        invoice = self._start_billing_attempt(subscription, plan, attempt_number=1, await_webhook=True)
        self.repositories.session.commit()
        return invoice

    def retry_payment(self, subscription_id: str) -> Invoice:
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        if not subscription:
            raise NotFoundError("Unknown subscription")
        if subscription.status != SubscriptionStatus.PAST_DUE:
            raise ValueError("Retry is only allowed for past due subscriptions")
        plan = self.plans.get(subscription.plan)
        attempt_number = self._next_attempt_number(subscription_id)
        invoice = self._start_billing_attempt(subscription, plan, attempt_number, await_webhook=True)
        self.repositories.session.commit()
        return invoice

    def process_webhook(self, payload: dict[str, object]) -> bool:
        event_id = self._required_string(payload, "event_id")
        if self.repositories.webhooks.get_by_event_id(event_id):
            return False
        subscription_id = self._required_string(payload, "subscription_id")
        invoice_id = self._required_string(payload, "invoice_id")
        event_type = self._required_string(payload, "type")
        subscription = self.repositories.subscriptions.subscription(subscription_id)
        invoice = self.repositories.invoices.get(invoice_id)
        if not subscription or not invoice or invoice.subscription_id != subscription.id:
            raise NotFoundError("Unknown subscription or invoice")
        self._validate_invoice_values(payload, invoice)
        webhook = WebhookEvent(event_id=event_id, type=event_type,
                               subscription_id=subscription_id, invoice_id=invoice_id,
                               payload=json.dumps(payload), processed=False)
        self.repositories.webhooks.add(webhook)
        if event_type == "payment.succeeded":
            self._process_success(subscription, invoice, event_id)
        elif event_type == "payment.failed":
            self._process_failure(subscription, invoice, event_id, payload.get("retries_exhausted") is True)
        elif event_type == "payment.refunded":
            self._record_refund(subscription, event_id)
        else:
            raise ValueError("Unsupported webhook type")
        webhook.processed = True
        self.repositories.session.commit()
        return True

    def _start_billing_attempt(
        self, subscription: Subscription, plan: Plan, attempt_number: int, *, await_webhook: bool
    ) -> Invoice:
        invoice = Invoice(
            subscription_id=subscription.id,
            amount=plan.price,
            currency=plan.currency,
            status="open",
            attempt_number=attempt_number,
        )
        self.repositories.invoices.add(invoice)
        self.repositories.session.flush()
        result = self.provider.charge(ChargeRequest(
            customer_id=subscription.customer_id,
            payment_method_id=subscription.payment_method_id,
            amount=plan.price,
            currency=plan.currency,
            idempotency_key=invoice.id,
        ))
        invoice.provider_reference = result.reference

        if await_webhook:
            # Retry/trial-end attempts are asynchronous: the signed webhook is
            # the source of truth for payment finalization and state change.
            invoice.status = "pending"
        elif result.status == "succeeded":
            self._record_payment(invoice, subscription, "succeeded", result.reference)
            self._transition(subscription, LifecycleEvent.PAYMENT_SUCCEEDED, result.reference)
        elif result.status == "declined":
            self._record_payment(invoice, subscription, "failed", result.reference)
            self._transition(subscription, LifecycleEvent.PAYMENT_FAILED, result.reference)
        elif result.status in {"pending", "timeout"}:
            invoice.status = "pending"
        return invoice

    def _process_success(self, subscription: Subscription, invoice: Invoice, event_id: str) -> None:
        if subscription.status == SubscriptionStatus.CANCELED or invoice.status == "paid":
            return
        self._record_payment(invoice, subscription, "succeeded", invoice.provider_reference or event_id)
        event = (LifecycleEvent.RETRY_SUCCEEDED if subscription.status == SubscriptionStatus.PAST_DUE
                 else LifecycleEvent.PAYMENT_SUCCEEDED)
        self._transition(subscription, event, event_id)

    def _process_failure(self, subscription: Subscription, invoice: Invoice, event_id: str,
                         retries_exhausted: bool) -> None:
        # A late failure for a paid invoice cannot overturn the successful billing outcome.
        if subscription.status == SubscriptionStatus.CANCELED or invoice.status == "paid":
            return
        self._record_payment(invoice, subscription, "failed", invoice.provider_reference or event_id)
        if subscription.status in {SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE}:
            self._transition(subscription, LifecycleEvent.PAYMENT_FAILED, event_id)
        elif subscription.status == SubscriptionStatus.PAST_DUE and retries_exhausted:
            self._transition(subscription, LifecycleEvent.RETRIES_EXHAUSTED, event_id)

    def _record_refund(self, subscription: Subscription, event_id: str) -> None:
        status = SubscriptionStatus(subscription.status)
        self.repositories.audits.add(AuditEvent(subscription_id=subscription.id,
                                                event_type="payment.refunded", from_status=status,
                                                to_status=status, reference_id=event_id))

    def _record_payment(self, invoice: Invoice, subscription: Subscription, status: str, reference: str) -> None:
        self.repositories.payments.add(Payment(invoice_id=invoice.id, subscription_id=subscription.id,
                                                amount=invoice.amount, currency=invoice.currency,
                                                status=status, provider_reference=reference))
        invoice.status = "paid" if status == "succeeded" else "failed"

    def _transition(self, subscription: Subscription, event: LifecycleEvent, reference_id: str) -> None:
        before = SubscriptionStatus(subscription.status)
        after = self.state_machine.transition(before, event)
        subscription.status = after
        self.repositories.audits.add(AuditEvent(subscription_id=subscription.id, event_type=event,
                                                from_status=before, to_status=after,
                                                reference_id=reference_id))

    def get_subscription(self, subscription_id: str) -> Subscription | None:
        return self.repositories.subscriptions.subscription(subscription_id)

    def _next_attempt_number(self, subscription_id: str) -> int:
        invoices = self.repositories.invoices.for_subscription(subscription_id)
        if not invoices:
            raise ValueError("No invoice found for subscription")
        return max(invoice.attempt_number for invoice in invoices) + 1

    @staticmethod
    def _required_string(payload: dict[str, object], name: str) -> str:
        value = payload.get(name)
        if not isinstance(value, str) or not value:
            raise ValueError(f"{name} must be a non-empty string")
        return value

    @staticmethod
    def _validate_invoice_values(payload: dict[str, object], invoice: Invoice) -> None:
        amount = payload.get("amount")
        currency = payload.get("currency")
        if isinstance(amount, bool) or not isinstance(amount, int) or amount != invoice.amount:
            raise ValueError("Webhook amount does not match invoice")
        if not isinstance(currency, str) or currency != invoice.currency:
            raise ValueError("Webhook currency does not match invoice")
