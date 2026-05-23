"""Schema gate: every table/column the test suite assumes must exist.

Run as a CI step. Exits non-zero with a clear message if the SUT schema
drifted away from what the tests expect.
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from service.app import init_schema  # noqa: E402

REQUIRED = {
    "wallets": {"wallet_id", "owner_id", "currency", "balance_minor", "created_at"},
    "transfers": {
        "transfer_id",
        "source_wallet_id",
        "dest_wallet_id",
        "amount_minor",
        "currency",
        "reference",
        "status",
        "failure_reason",
        "created_at",
        "completed_at",
    },
    "idempotency_keys": {"idem_key", "request_hash", "transfer_id", "created_at"},
    "ledger_entries": {
        "entry_id",
        "transfer_id",
        "wallet_id",
        "direction",
        "amount_minor",
        "balance_after_minor",
        "created_at",
    },
    "outbox": {
        "event_id",
        "aggregate_id",
        "event_type",
        "payload",
        "published",
        "created_at",
    },
}


def main():
    conn = sqlite3.connect(":memory:")
    init_schema(conn)
    errors = []
    for table, required_cols in REQUIRED.items():
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # nosec B608
        existing = {r[1] for r in rows}
        missing = required_cols - existing
        if missing:
            errors.append(f"{table}: missing {sorted(missing)}")
        else:
            print(f"  ok  {table}")
    conn.close()
    if errors:
        for e in errors:
            print(f"FAIL  {e}", file=sys.stderr)
        sys.exit(1)
    print("schema OK")


if __name__ == "__main__":
    main()
