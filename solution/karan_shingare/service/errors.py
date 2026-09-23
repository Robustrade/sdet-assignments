class ValidationError(Exception):
    """Request or webhook payload failed validation."""


class NotFoundError(Exception):
    """Referenced entity does not exist."""


class InvalidTransitionError(Exception):
    """Requested lifecycle transition is not allowed from the current state."""
