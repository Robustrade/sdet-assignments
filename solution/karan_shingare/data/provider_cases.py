"""Schema for provider-call-count-by-plan cases.

Values live as JSON in tests/api/vars/TestProviderCallCountByPlan.json.
Richer per-call assertions (call arguments, idempotency-key presence) stay
as dedicated tests in test_provider_interaction.py since a call count alone
doesn't capture what those verify.
"""
from dataclasses import dataclass


@dataclass
class ProviderCallCountCase:
    name: str
    plan: str
    expected_call_count: int
