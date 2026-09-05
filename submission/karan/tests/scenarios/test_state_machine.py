import pytest

from app.domain.state_machine import SubscriptionStateMachine
from app.domain.states import LifecycleEvent, SubscriptionStatus, TransitionError


def test_trialing_payment_success_is_a_valid_transition():
    assert SubscriptionStateMachine().transition(SubscriptionStatus.TRIALING, LifecycleEvent.PAYMENT_SUCCEEDED) == SubscriptionStatus.ACTIVE


def test_terminal_canceled_subscription_cannot_reactivate():
    with pytest.raises(TransitionError):
        SubscriptionStateMachine().transition(SubscriptionStatus.CANCELED, LifecycleEvent.PAYMENT_SUCCEEDED)


@pytest.mark.parametrize(
    ("status", "event", "expected"),
    [
        (SubscriptionStatus.TRIALING, LifecycleEvent.PAYMENT_FAILED, SubscriptionStatus.PAST_DUE),
        (SubscriptionStatus.TRIALING, LifecycleEvent.CANCEL, SubscriptionStatus.CANCELED),
        (SubscriptionStatus.ACTIVE, LifecycleEvent.PAYMENT_FAILED, SubscriptionStatus.PAST_DUE),
        (SubscriptionStatus.ACTIVE, LifecycleEvent.CANCEL, SubscriptionStatus.CANCELED),
        (SubscriptionStatus.PAST_DUE, LifecycleEvent.RETRY_SUCCEEDED, SubscriptionStatus.ACTIVE),
        (SubscriptionStatus.PAST_DUE, LifecycleEvent.RETRIES_EXHAUSTED, SubscriptionStatus.CANCELED),
    ],
)
def test_remaining_documented_lifecycle_transitions(status, event, expected):
    assert SubscriptionStateMachine().transition(status, event) == expected


@pytest.mark.parametrize("status,event", [
    (SubscriptionStatus.TRIALING, LifecycleEvent.RETRY_SUCCEEDED),
    (SubscriptionStatus.ACTIVE, LifecycleEvent.RETRY_SUCCEEDED),
    (SubscriptionStatus.ACTIVE, LifecycleEvent.RETRIES_EXHAUSTED),
])
def test_invalid_lifecycle_transitions_are_rejected(status, event):
    with pytest.raises(TransitionError):
        SubscriptionStateMachine().transition(status, event)
