"""Reusable read helpers over the service repositories, for test assertions.

Thin, named lookups only - no test-specific logic lives here. Tests import
these instead of repeating the same list-comprehension over `repos` in
every file that needs it.
"""
from typing import Protocol

from service.repository import AuditLogRepository, InvoiceRepository


class _ReposLike(Protocol):
    invoices: InvoiceRepository
    audit: AuditLogRepository


def invoice_statuses(repos: _ReposLike, subscription_id: str) -> list[str]:
    return [inv.status for inv in repos.invoices.list_for_subscription(subscription_id)]


def has_paid_invoice(repos: _ReposLike, subscription_id: str) -> bool:
    return any(inv.status == "paid" for inv in repos.invoices.list_for_subscription(subscription_id))


def status_history(repos: _ReposLike, subscription_id: str) -> list[str]:
    return [event["to_status"] for event in repos.audit.list_for(subscription_id)]
