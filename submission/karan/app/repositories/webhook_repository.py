from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import WebhookEvent


class WebhookRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, webhook: WebhookEvent) -> None:
        self.session.add(webhook)

    def get_by_event_id(self, event_id: str) -> WebhookEvent | None:
        return self.session.scalar(select(WebhookEvent).where(WebhookEvent.event_id == event_id))

    def for_subscription(self, subscription_id: str) -> list[WebhookEvent]:
        return list(self.session.scalars(select(WebhookEvent).where(WebhookEvent.subscription_id == subscription_id)))
