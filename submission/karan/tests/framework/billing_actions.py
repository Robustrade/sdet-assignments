"""Service-level billing actions for scenario tests (e.g. retry_payment)."""

from __future__ import annotations

from app.database import Repositories
from app.domain.models import Invoice
from app.providers.mock_payment_provider import MockPaymentProvider
from app.services.subscription_service import SubscriptionService


def retry_payment(repositories: Repositories, provider: MockPaymentProvider, subscription_id: str) -> Invoice:
    return SubscriptionService(repositories, provider).retry_payment(subscription_id)
