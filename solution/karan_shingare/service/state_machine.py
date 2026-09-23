"""State pattern for the subscription lifecycle.

Each concrete state only implements the transitions that are actually legal
from it. Anything not overridden falls back to the no-op base behaviour,
which is what makes illegal transitions structurally unreachable instead of
something we have to remember to check with an if-statement.
"""
from typing import Optional

MAX_RETRIES: int = 3


class SubscriptionState:
    name: Optional[str] = None

    def on_payment_succeeded(self) -> Optional[str]:
        return None

    def on_payment_failed(self, retries_exhausted: bool = False) -> Optional[str]:
        return None

    def on_cancel(self) -> Optional[str]:
        return None


class Trialing(SubscriptionState):
    name = "trialing"

    def on_payment_succeeded(self) -> str:
        return "active"

    def on_payment_failed(self, retries_exhausted: bool = False) -> str:
        return "past_due"

    def on_cancel(self) -> str:
        return "canceled"


class Active(SubscriptionState):
    name = "active"

    def on_payment_failed(self, retries_exhausted: bool = False) -> str:
        return "past_due"

    def on_cancel(self) -> str:
        return "canceled"


class PastDue(SubscriptionState):
    name = "past_due"

    def on_payment_succeeded(self) -> str:
        return "active"

    def on_payment_failed(self, retries_exhausted: bool = False) -> Optional[str]:
        return "canceled" if retries_exhausted else None

    def on_cancel(self) -> str:
        return "canceled"


class Canceled(SubscriptionState):
    name = "canceled"
    # canceled is terminal: every event above is a no-op by inheriting the
    # base class, so nothing can ever move a subscription back out of it.


STATES: dict[str, SubscriptionState] = {
    "trialing": Trialing(),
    "active": Active(),
    "past_due": PastDue(),
    "canceled": Canceled(),
}


def next_status(current_status: str, event_type: str, retries_exhausted: bool = False) -> Optional[str]:
    """Return the new status for an event, or None if the event doesn't
    cause a transition from the current state (invalid or already-applied)."""
    state = STATES[current_status]
    if event_type == "payment_succeeded":
        return state.on_payment_succeeded()
    if event_type == "payment_failed":
        return state.on_payment_failed(retries_exhausted)
    if event_type == "cancel":
        return state.on_cancel()
    raise ValueError(f"unknown event type: {event_type}")
