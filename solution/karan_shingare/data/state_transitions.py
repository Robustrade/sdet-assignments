"""Schema for the subscription lifecycle's full transition table.

Values live as JSON in tests/api/vars/TestStateMachineTransitionTable.json,
one entry per (status, event) row. Exercises service.state_machine.next_status
directly, a pure function, no HTTP/DB involved, so every legal transition
and every no-op is covered as one flat table instead of individually
hand-written unit tests. This complements (doesn't replace) the HTTP-level
lifecycle tests in test_state_machine.py, which prove the *service* honors
these transitions end to end.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class TransitionCase:
    name: str
    current_status: str
    event_type: str
    retries_exhausted: bool = False
    expected_status: Optional[str] = None  # None => no transition (no-op / illegal from here)
