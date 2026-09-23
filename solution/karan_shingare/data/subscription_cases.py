"""Schema for POST /subscriptions validation cases.

This module only defines the *shape* of a case. The actual values live as
JSON next to the tests that use them (tests/api/vars/TestCreateSubscription.json),
loaded through utils/data_driven.py. Keeping the dataclass here means a
test still gets typed attribute access (case.expected_status, not
case["expected_status"]) built from that JSON.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SubscriptionCreationCase:
    name: str
    plan: str = "pro"
    payment_method_id: Optional[str] = "pm_test_visa_4242"
    customer_id: Optional[str] = None  # None => use the test's provisioned customer
    expected_status: int = 201
    expected_body: dict = field(default_factory=dict)
    expected_error_contains: Optional[str] = None
    expected_provider_calls: Optional[int] = None  # None => not asserted by this case
