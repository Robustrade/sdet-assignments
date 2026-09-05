from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import Customer, Subscription


class SubscriptionRepository:
    """Persistence access for customers and subscriptions."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def add_customer(self, customer: Customer) -> None:
        self.session.add(customer)

    def find_customer(self, customer_id: str) -> Customer | None:
        return self.session.get(Customer, customer_id)

    def add_subscription(self, subscription: Subscription) -> None:
        self.session.add(subscription)

    def subscription(self, subscription_id: str) -> Subscription | None:
        return self.session.get(Subscription, subscription_id)

    def subscriptions_for(self, customer_id: str) -> list[Subscription]:
        return list(self.session.scalars(select(Subscription).where(Subscription.customer_id == customer_id)))
