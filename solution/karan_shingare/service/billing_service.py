import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from service.errors import ValidationError, NotFoundError, InvalidTransitionError
from service.models import Subscription, Invoice
from service.payment_provider import PaymentProvider, ProviderDecline, ProviderTimeout
from service.plans import PLANS
from service.repository import CustomerRepository, SubscriptionRepository, InvoiceRepository, \
    WebhookEventRepository, AuditLogRepository
from service.state_machine import next_status, MAX_RETRIES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class BillingService:
    """Ties together persistence, the state machine and the payment provider.

    This is the one place that decides what a lifecycle event actually does;
    the Flask routes are thin wrappers that just translate HTTP <-> this API.
    """

    def __init__(self, conn: sqlite3.Connection, provider: PaymentProvider) -> None:
        self._provider = provider
        self.customers = CustomerRepository(conn)
        self.subscriptions = SubscriptionRepository(conn)
        self.invoices = InvoiceRepository(conn)
        self.webhook_events = WebhookEventRepository(conn)
        self.audit = AuditLogRepository(conn)

    def create_subscription(
        self,
        customer_id: Optional[str] = None,
        plan: Optional[str] = None,
        payment_method_id: Optional[str] = None,
    ) -> Subscription:
        if not customer_id or not plan or not payment_method_id:
            raise ValidationError("customer_id, plan and payment_method_id are all required")
        if plan not in PLANS:
            raise ValidationError(f"unknown plan: {plan}")
        if not self.customers.exists(customer_id):
            raise ValidationError(f"unknown customer: {customer_id}")
        if not payment_method_id.startswith("pm_"):
            raise ValidationError(f"invalid payment_method_id: {payment_method_id}")

        plan_cfg = PLANS[plan]
        created_at = _now()
        trial_end = (datetime.now(timezone.utc) + timedelta(days=plan_cfg.trial_days)).isoformat()

        sub = Subscription(
            id=f"sub_{uuid.uuid4().hex[:12]}",
            customer_id=customer_id,
            plan=plan,
            status="trialing",
            payment_method_id=payment_method_id,
            trial_end=trial_end,
            created_at=created_at,
            canceled_at=None,
            retry_count=0,
        )
        self.subscriptions.create(sub)
        self.audit.record(sub.id, "created", None, "trialing", created_at)

        if plan_cfg.trial_days == 0:
            # No trial for this plan: bill immediately, same code path a
            # trial-end billing run would use.
            sub = self._bill(sub, is_retry=False)

        return sub

    def get_subscription(self, sub_id: str) -> Subscription:
        sub = self.subscriptions.get(sub_id)
        if sub is None:
            raise NotFoundError(f"no such subscription: {sub_id}")
        return sub

    def cancel_subscription(self, sub_id: str) -> Subscription:
        sub = self.get_subscription(sub_id)
        new_status = next_status(sub.status, "cancel")
        if new_status is None:
            raise InvalidTransitionError(f"cannot cancel a subscription in status '{sub.status}'")
        self.subscriptions.update_status(sub_id, new_status, canceled_at=_now())
        self.audit.record(sub_id, "canceled", sub.status, new_status, _now())
        return self.subscriptions.get(sub_id)

    def charge_now(self, sub_id: str) -> Subscription:
        """First charge for a trialing subscription whose trial just ended."""
        sub = self.get_subscription(sub_id)
        if sub.status != "trialing":
            raise InvalidTransitionError("subscription is not awaiting its first charge")
        return self._bill(sub, is_retry=False)

    def retry_charge(self, sub_id: str) -> Subscription:
        """Billing retry for a past_due subscription."""
        sub = self.get_subscription(sub_id)
        if sub.status != "past_due":
            raise InvalidTransitionError("subscription is not past_due")
        return self._bill(sub, is_retry=True)

    def _bill(self, sub: Subscription, is_retry: bool) -> Subscription:
        plan_cfg = PLANS[sub.plan]
        invoice_id = f"inv_{uuid.uuid4().hex[:12]}"

        try:
            result = self._provider.charge(
                customer_id=sub.customer_id,
                amount=plan_cfg.price_cents,
                currency=plan_cfg.currency,
                payment_method_id=sub.payment_method_id,
                idempotency_key=invoice_id,
            )
            self.invoices.create(Invoice(
                id=invoice_id, subscription_id=sub.id, amount=plan_cfg.price_cents,
                currency=plan_cfg.currency, status="paid",
                provider_reference=result.provider_reference, created_at=_now(),
            ))
            event_type = "payment_succeeded"
        except (ProviderDecline, ProviderTimeout):
            self.invoices.create(Invoice(
                id=invoice_id, subscription_id=sub.id, amount=plan_cfg.price_cents,
                currency=plan_cfg.currency, status="failed",
                provider_reference=None, created_at=_now(),
            ))
            event_type = "payment_failed"
            if is_retry:
                self.subscriptions.increment_retry(sub.id)
                sub = self.subscriptions.get(sub.id)

        retries_exhausted = is_retry and sub.retry_count >= MAX_RETRIES
        new_status = next_status(sub.status, event_type, retries_exhausted)
        if new_status:
            self.subscriptions.update_status(sub.id, new_status)
            self.audit.record(sub.id, "status_changed", sub.status, new_status, _now())

        return self.subscriptions.get(sub.id)

    def handle_webhook(self, payload: dict) -> dict:
        required_fields = {"event_id", "type", "subscription_id"}
        if not payload or not required_fields.issubset(payload):
            raise ValidationError("webhook payload missing required fields")

        event_id = payload["event_id"]
        if self.webhook_events.has_processed(event_id):
            return {"status": "duplicate", "event_id": event_id}

        self.webhook_events.record(event_id, payload["type"], payload.get("subscription_id"), payload, _now())

        sub = self.subscriptions.get(payload["subscription_id"])
        if sub is None:
            return {"status": "ignored", "reason": "unknown subscription"}

        event_type = payload["type"]
        if event_type == "payment.refunded":
            return self._handle_refund(payload)
        if event_type in ("payment.succeeded", "payment.failed"):
            return self._handle_payment_event(sub, payload, event_type)
        return {"status": "ignored", "reason": f"unsupported event type: {event_type}"}

    def _handle_refund(self, payload: dict) -> dict:
        invoice_id = payload.get("invoice_id")
        invoice = self.invoices.get(invoice_id) if invoice_id else None
        if invoice is None:
            return {"status": "ignored", "reason": "unknown invoice"}
        self.invoices.mark_status(invoice_id, "refunded")
        # Refunds are recorded but don't drive a lifecycle transition in this
        # fixture - see STRATEGY.md for the reasoning.
        return {"status": "processed", "invoice_id": invoice_id}

    def _handle_payment_event(self, sub: Subscription, payload: dict, event_type: str) -> dict:
        invoice_id = payload.get("invoice_id")
        if not invoice_id:
            raise ValidationError("payment webhook missing invoice_id")

        existing = self.invoices.get(invoice_id)
        if existing and existing.status in ("paid", "failed"):
            # Either an exact resend under a new event_id, or a late/out-of-order
            # event for an invoice we already resolved - either way, no-op.
            return {"status": "stale", "invoice_id": invoice_id}

        new_invoice_status = "paid" if event_type == "payment.succeeded" else "failed"
        if existing:
            self.invoices.mark_status(invoice_id, new_invoice_status)
        else:
            plan_cfg = PLANS[sub.plan]
            self.invoices.create(Invoice(
                id=invoice_id, subscription_id=sub.id,
                amount=payload.get("amount", plan_cfg.price_cents),
                currency=payload.get("currency", plan_cfg.currency),
                status=new_invoice_status, provider_reference=None, created_at=_now(),
            ))

        if event_type == "payment.failed" and sub.status == "past_due":
            self.subscriptions.increment_retry(sub.id)
            sub = self.subscriptions.get(sub.id)

        retries_exhausted = sub.status == "past_due" and sub.retry_count >= MAX_RETRIES
        state_event = "payment_succeeded" if new_invoice_status == "paid" else "payment_failed"
        new_status = next_status(sub.status, state_event, retries_exhausted)
        if new_status:
            self.subscriptions.update_status(sub.id, new_status)
            self.audit.record(sub.id, "status_changed", sub.status, new_status, _now())

        return {
            "status": "processed",
            "invoice_id": invoice_id,
            "subscription_status": new_status or sub.status,
        }
