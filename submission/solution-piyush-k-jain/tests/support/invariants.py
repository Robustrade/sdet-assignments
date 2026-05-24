"""Domain-level assertion helpers.

Tests read at the level of business behavior:

    assert_exactly_one_debit(verifier, "wallet_001", before=10_000, by=2_500)
    assert_no_balance_movement(verifier, before, after)
    assert_outbox_emitted_once(verifier, publisher, transfer_id)

Adding a new invariant once here is preferable to inlining the same SQL +
assertion across multiple test files.
"""

from __future__ import annotations

from typing import Any

from service.outbox import NotificationRecorder, StubPublisher

from .db_verifier import DbVerifier


def assert_exactly_one_debit(
    verifier: DbVerifier, wallet_id: str, before: int, by: int
) -> None:
    after = verifier.wallet_balance(wallet_id)
    assert after == before - by, (
        f"wallet {wallet_id}: expected debit of exactly {by} from {before}; "
        f"observed final balance {after} (delta {after - before})"
    )


def assert_exactly_one_credit(
    verifier: DbVerifier, wallet_id: str, before: int, by: int
) -> None:
    after = verifier.wallet_balance(wallet_id)
    assert after == before + by, (
        f"wallet {wallet_id}: expected credit of exactly {by} from {before}; "
        f"observed final balance {after} (delta {after - before})"
    )


def assert_no_balance_movement(verifier: DbVerifier, before: dict[str, int]) -> None:
    for wallet_id, original in before.items():
        current = verifier.wallet_balance(wallet_id)
        assert (
            current == original
        ), f"wallet {wallet_id} moved: was {original}, now {current}"


def assert_balance_conserved(before: dict[str, int], after: dict[str, int]) -> None:
    """Total balance across the involved wallets must be unchanged by a transfer."""
    assert sum(before.values()) == sum(after.values()), (
        f"balance conservation violated: before total {sum(before.values())}, "
        f"after total {sum(after.values())}, before={before}, after={after}"
    )


def assert_single_transfer_row(verifier: DbVerifier) -> None:
    count = verifier.transfer_count()
    assert count == 1, f"expected exactly one transfer row, found {count}"


def assert_no_transfer_rows(verifier: DbVerifier) -> None:
    count = verifier.transfer_count()
    assert count == 0, f"expected no transfer rows, found {count}"


def assert_transfer_status(
    verifier: DbVerifier, transfer_id: str, expected: str
) -> None:
    row = verifier.transfer(transfer_id)
    assert row is not None, f"transfer {transfer_id} not persisted"
    assert (
        row["status"] == expected
    ), f"transfer {transfer_id} status: expected {expected!r}, got {row['status']!r}"


def assert_audit_event_types(
    verifier: DbVerifier, transfer_id: str, expected: list[str]
) -> None:
    observed = verifier.audit_event_types_for(transfer_id)
    assert (
        observed == expected
    ), f"audit trail mismatch for {transfer_id}: expected {expected}, got {observed}"


def assert_outbox_emitted_once(
    verifier: DbVerifier, publisher: StubPublisher, transfer_id: str
) -> None:
    rows = verifier.outbox_rows_for(transfer_id)
    assert (
        len(rows) == 1
    ), f"outbox: expected exactly 1 row for {transfer_id}, found {len(rows)}"
    assert (
        rows[0]["published"] == 1
    ), f"outbox row for {transfer_id} not marked published"
    publishes = publisher.events_for(transfer_id)
    assert len(publishes) == 1, (
        f"publisher: expected exactly 1 publish for {transfer_id}, "
        f"found {len(publishes)}"
    )


def assert_no_outbox_emission(
    verifier: DbVerifier, publisher: StubPublisher, transfer_id: str
) -> None:
    rows = verifier.outbox_rows_for(transfer_id)
    assert rows == [], f"outbox: expected no rows for {transfer_id}, found {len(rows)}"
    assert (
        publisher.events_for(transfer_id) == []
    ), f"publisher should not have emitted for {transfer_id}"


def assert_notified_once(notifier: NotificationRecorder, transfer_id: str) -> None:
    calls = notifier.calls_for(transfer_id)
    assert (
        len(calls) == 1
    ), f"notifier: expected exactly 1 call for {transfer_id}, found {len(calls)}"


def assert_not_notified(notifier: NotificationRecorder, transfer_id: str) -> None:
    calls = notifier.calls_for(transfer_id)
    assert (
        calls == []
    ), f"notifier: expected no calls for {transfer_id}, found {len(calls)}"


def assert_response_equivalent(first: dict[str, Any], second: dict[str, Any]) -> None:
    """Idempotent replays must return byte-equal bodies (same id, same fields)."""
    assert (
        first == second
    ), f"idempotent replay returned different body:\n  first={first}\n  second={second}"
