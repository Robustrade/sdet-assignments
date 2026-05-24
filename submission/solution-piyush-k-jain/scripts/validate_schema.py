"""Validate the wallet-transfer schema against the required structure.

Required by the `db-migration-or-schema-check` CI job. Exits non-zero if any
required table or column is missing. Run with:

    python scripts/validate_schema.py
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from service.db import REQUIRED_TABLES, init_schema  # noqa: E402


def main() -> int:
    conn = sqlite3.connect(":memory:")
    init_schema(conn)

    errors: list[str] = []
    for table, required_cols in REQUIRED_TABLES.items():
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # nosec
        if not rows:
            errors.append(f"table '{table}' is missing entirely")
            continue
        existing = {row[1] for row in rows}
        missing = required_cols - existing
        if missing:
            errors.append(f"table '{table}' missing columns: {sorted(missing)}")
        else:
            print(f"OK: {table} ({len(existing)} columns)")

    conn.close()

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print("Schema validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
