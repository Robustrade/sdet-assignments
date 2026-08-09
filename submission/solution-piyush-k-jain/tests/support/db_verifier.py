"""Read-only helpers that turn raw SQL into domain queries.

Tests should never write SQL themselves. If a new query is needed, add it here
with an intent-revealing name so all tests benefit and the contract between
test and schema is centralized.
"""

from __future__ import annotations

import sqlite3
from typing import Any


class DbVerifier:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    # ── wallets ─────────────────────────────────────────────────────────────
    def wallet_balance(self, wallet_id: str) -> int:
        row = self._conn.execute(
            "SELECT balance FROM wallets WHERE id = ?", (wallet_id,)
        ).fetchone()
        assert row is not None, f"wallet {wallet_id} not seeded"
        return int(row["balance"])

    # ── transfers ──────────────────────────────────────────────────────────
    def transfer(self, transfer_id: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM transfers WHERE id = ?", (transfer_id,)
        ).fetchone()

    def transfer_count(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM transfers").fetchone()[0])

    def transfers_by_status(self, status: str) -> int:
        return int(
            self._conn.execute(
                "SELECT COUNT(*) FROM transfers WHERE status = ?", (status,)
            ).fetchone()[0]
        )

    # ── idempotency keys ───────────────────────────────────────────────────
    def idempotency_row(self, key: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM idempotency_keys WHERE key = ?", (key,)
        ).fetchone()

    def idempotency_count(self) -> int:
        return int(
            self._conn.execute("SELECT COUNT(*) FROM idempotency_keys").fetchone()[0]
        )

    # ── audit / transfer_events ────────────────────────────────────────────
    def audit_events_for(self, transfer_id: str) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                "SELECT * FROM transfer_events WHERE transfer_id = ?"
                " ORDER BY created_at",
                (transfer_id,),
            ).fetchall()
        )

    def audit_event_types_for(self, transfer_id: str) -> list[str]:
        return [r["event_type"] for r in self.audit_events_for(transfer_id)]

    def audit_event_count(self) -> int:
        return int(
            self._conn.execute("SELECT COUNT(*) FROM transfer_events").fetchone()[0]
        )

    # ── outbox ─────────────────────────────────────────────────────────────
    def outbox_rows_for(self, transfer_id: str) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                "SELECT * FROM outbox_events WHERE transfer_id = ?", (transfer_id,)
            ).fetchall()
        )

    def outbox_count(self) -> int:
        return int(
            self._conn.execute("SELECT COUNT(*) FROM outbox_events").fetchone()[0]
        )

    def outbox_published_count(self, transfer_id: str) -> int:
        return int(
            self._conn.execute(
                "SELECT COUNT(*) FROM outbox_events"
                " WHERE transfer_id = ? AND published = 1",
                (transfer_id,),
            ).fetchone()[0]
        )

    # ── generic ────────────────────────────────────────────────────────────
    def row_count(self, table: str) -> int:
        # Whitelist before interpolation to keep bandit + reviewers happy.
        if table not in {
            "wallets",
            "transfers",
            "idempotency_keys",
            "transfer_events",
            "outbox_events",
        }:
            raise ValueError(f"unknown table: {table}")
        sql = f"SELECT COUNT(*) FROM {table}"  # nosec
        return int(self._conn.execute(sql).fetchone()[0])

    def snapshot_balances(self, *wallet_ids: str) -> dict[str, int]:
        return {w: self.wallet_balance(w) for w in wallet_ids}


def diff_balances(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    return {w: after[w] - before[w] for w in before}


def _coerce_dict(value: Any) -> dict[str, Any]:
    """Internal helper used by tests when they want a plain-dict snapshot."""
    return dict(value) if value is not None else {}
