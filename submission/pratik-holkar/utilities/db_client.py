"""Read-side helpers tests use to assert persistence.

Tests should never embed raw SQL. If you need a new check, add a method
here so the SQL has one home and the test bodies stay readable.
"""

from __future__ import annotations

import sqlite3


class WalletDbClient:
    def __init__(self, conn: sqlite3.Connection):
        self._c = conn

    # wallets ----------------------------------------------------------------

    def balance(self, wallet_id: str) -> int | None:
        row = self._c.execute(
            "SELECT balance_minor FROM wallets WHERE wallet_id = ?", (wallet_id,)
        ).fetchone()
        return None if row is None else row["balance_minor"]

    def total_balance(self) -> int:
        row = self._c.execute("SELECT COALESCE(SUM(balance_minor),0) AS t FROM wallets").fetchone()
        return row["t"]

    def seed_wallet(self, wallet_id: str, owner_id: str, currency: str, balance_minor: int):
        self._c.execute(
            "INSERT OR REPLACE INTO wallets "
            "(wallet_id, owner_id, currency, balance_minor, created_at) "
            "VALUES (?, ?, ?, ?, datetime('now'))",
            (wallet_id, owner_id, currency, balance_minor),
        )
        self._c.commit()

    # transfers --------------------------------------------------------------

    def transfer_count(self) -> int:
        return self._c.execute("SELECT COUNT(*) AS n FROM transfers").fetchone()["n"]

    def transfer(self, transfer_id: str) -> dict | None:
        row = self._c.execute(
            "SELECT * FROM transfers WHERE transfer_id = ?", (transfer_id,)
        ).fetchone()
        return None if row is None else dict(row)

    def transfers_for_key(self, idem_key: str) -> list[dict]:
        rows = self._c.execute(
            "SELECT t.* FROM transfers t "
            "JOIN idempotency_keys k ON k.transfer_id = t.transfer_id "
            "WHERE k.idem_key = ?",
            (idem_key,),
        ).fetchall()
        return [dict(r) for r in rows]

    # idempotency ------------------------------------------------------------

    def idem_rows_for_key(self, idem_key: str) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM idempotency_keys WHERE idem_key = ?", (idem_key,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ledger -----------------------------------------------------------------

    def ledger_for_transfer(self, transfer_id: str) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM ledger_entries WHERE transfer_id = ? ORDER BY direction",
            (transfer_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def ledger_count(self) -> int:
        return self._c.execute("SELECT COUNT(*) AS n FROM ledger_entries").fetchone()["n"]

    # outbox -----------------------------------------------------------------

    def outbox_count(self, transfer_id: str | None = None) -> int:
        if transfer_id is None:
            return self._c.execute("SELECT COUNT(*) AS n FROM outbox").fetchone()["n"]
        return self._c.execute(
            "SELECT COUNT(*) AS n FROM outbox WHERE aggregate_id = ?", (transfer_id,)
        ).fetchone()["n"]

    def outbox_for_transfer(self, transfer_id: str) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM outbox WHERE aggregate_id = ?", (transfer_id,)
        ).fetchall()
        return [dict(r) for r in rows]
