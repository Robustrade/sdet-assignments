from enum import StrEnum


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class LifecycleEvent(StrEnum):
    PAYMENT_SUCCEEDED = "payment_succeeded"
    PAYMENT_FAILED = "payment_failed"
    CANCEL = "cancel"
    RETRY_SUCCEEDED = "retry_succeeded"
    RETRIES_EXHAUSTED = "retries_exhausted"


class TransitionError(ValueError):
    pass
