from __future__ import annotations

from app.domain.states import LifecycleEvent, SubscriptionStatus, TransitionError


class SubscriptionStateMachine:
    """The sole declaration of legal subscription lifecycle transitions."""

    TRANSITIONS = {
        (SubscriptionStatus.TRIALING, LifecycleEvent.PAYMENT_SUCCEEDED): SubscriptionStatus.ACTIVE,
        (SubscriptionStatus.TRIALING, LifecycleEvent.PAYMENT_FAILED): SubscriptionStatus.PAST_DUE,
        (SubscriptionStatus.TRIALING, LifecycleEvent.CANCEL): SubscriptionStatus.CANCELED,
        (SubscriptionStatus.ACTIVE, LifecycleEvent.PAYMENT_FAILED): SubscriptionStatus.PAST_DUE,
        (SubscriptionStatus.ACTIVE, LifecycleEvent.CANCEL): SubscriptionStatus.CANCELED,
        (SubscriptionStatus.PAST_DUE, LifecycleEvent.RETRY_SUCCEEDED): SubscriptionStatus.ACTIVE,
        (SubscriptionStatus.PAST_DUE, LifecycleEvent.RETRIES_EXHAUSTED): SubscriptionStatus.CANCELED,
    }

    def transition(self, status: SubscriptionStatus, event: LifecycleEvent) -> SubscriptionStatus:
        try:
            return self.TRANSITIONS[(status, event)]
        except KeyError as exc:
            raise TransitionError(f"{event} is invalid from {status}") from exc
