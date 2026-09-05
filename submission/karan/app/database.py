from dataclasses import dataclass

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.domain.models import Base
from app.repositories.audit_repository import AuditRepository
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.payment_repository import PaymentRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.repositories.webhook_repository import WebhookRepository


@dataclass(frozen=True)
class Repositories:
    """Composition-only container; persistence queries remain in individual repositories."""

    session: Session
    subscriptions: SubscriptionRepository
    invoices: InvoiceRepository
    payments: PaymentRepository
    webhooks: WebhookRepository
    audits: AuditRepository

    @classmethod
    def from_session(cls, session: Session) -> "Repositories":
        return cls(session, SubscriptionRepository(session), InvoiceRepository(session),
                   PaymentRepository(session), WebhookRepository(session), AuditRepository(session))


def create_schema(engine: Engine) -> None:
    Base.metadata.create_all(engine)
