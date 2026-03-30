"""Validate that the database schema contains all required tables and columns."""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from service.app import init_schema  # noqa: E402

REQUIRED: dict[str, set[str]] = {
    "wallets": {"id", "balance", "currency"},
    "transfers": {
        "id",
        "source_wallet_id",
        "destination_wallet_id",
        "amount",
        "currency",
        "status",
        "idempotency_key",
        "created_at",
    },
    "audit_events": {"id", "transfer_id", "event_type", "created_at"},
}


def main() -> None:
    conn = sqlite3.connect(":memory:")
    init_schema(conn)

    errors: list[str] = []
    for table, required_cols in REQUIRED.items():
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # nosec B608
        existing = {row[1] for row in rows}
        missing = required_cols - existing
        if missing:
            errors.append(f"Table '{table}' missing columns: {missing}")
        else:
            print(f"OK: {table}")

    conn.close()

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)

    print("Schema validation passed.")


if __name__ == "__main__":
    main()
