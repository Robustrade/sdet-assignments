from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import AuditEvent


class AuditRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, audit_event: AuditEvent) -> None:
        self.session.add(audit_event)

    def for_subscription(self, subscription_id: str) -> list[AuditEvent]:
        return list(self.session.scalars(select(AuditEvent).where(AuditEvent.subscription_id == subscription_id)))
