#!/usr/bin/env python3
"""
validate_schema.py
Validates that schema.sql applies cleanly to a real PostgreSQL instance
and that all expected tables, columns, indexes, and constraints exist.
Usage:
  python scripts/validate_schema.py
Environment variables (all have defaults for local runs):
  DB_HOST      default: localhost
  DB_PORT      default: 5432
  DB_NAME      default: wallet_schema_check
  DB_USER      default: wallet_user
  DB_PASSWORD  default: wallet_pass
  SCHEMA_FILE  default: src/test/resources/db/schema.sql
"""

import os
import sys
import psycopg2
from psycopg2 import sql

# ─── Configuration ────────────────────────────────────────────────────────────

DB_CONFIG = {
    "host":     os.environ.get("DB_HOST",     "localhost"),
    "port":     int(os.environ.get("DB_PORT", "5432")),
    "dbname":   os.environ.get("DB_NAME",     "wallet_schema_check"),
    "user":     os.environ.get("DB_USER",     "wallet_user"),
    "password": os.environ.get("DB_PASSWORD", "wallet_pass"),
}

SCHEMA_FILE = os.environ.get(
    "SCHEMA_FILE",
    os.path.join(os.path.dirname(__file__), "..", "src", "test", "resources", "db", "schema.sql")
)

# ─── Expected schema contract ─────────────────────────────────────────────────

EXPECTED_TABLES = [
    "wallets",
    "transfers",
    "idempotency_keys",
    "transfer_events",
    "outbox_events",
    "balance_snapshots",
]

EXPECTED_COLUMNS = {
    "wallets": [
        "id", "owner_id", "currency", "balance", "status",
        "created_at", "updated_at", "version",
    ],
    "transfers": [
        "id", "source_wallet_id", "destination_wallet_id", "amount",
        "currency", "status", "reference", "failure_reason",
        "idempotency_key", "created_at", "updated_at",
    ],
    "idempotency_keys": [
        "key", "transfer_id", "request_hash", "response",
        "created_at", "expires_at",
    ],
    "transfer_events": [
        "id", "transfer_id", "event_type", "payload",
        "created_at", "created_by",
    ],
    "outbox_events": [
        "id", "aggregate_id", "event_type", "payload", "status",
        "created_at", "published_at", "retry_count",
    ],
    "balance_snapshots": [
        "id", "wallet_id", "transfer_id", "balance_before",
        "balance_after", "delta", "snapshot_at",
    ],
}

EXPECTED_INDEXES = [
    ("wallets",           "idx_wallets_owner_id"),
    ("wallets",           "idx_wallets_currency"),
    ("transfers",         "idx_transfers_source_wallet"),
    ("transfers",         "idx_transfers_destination_wallet"),
    ("transfers",         "idx_transfers_status"),
    ("transfers",         "idx_transfers_created_at"),
    ("transfers",         "idx_transfers_idempotency_key"),
    ("idempotency_keys",  "idx_idempotency_keys_transfer_id"),
    ("idempotency_keys",  "idx_idempotency_keys_expires_at"),
    ("transfer_events",   "idx_transfer_events_transfer_id"),
    ("transfer_events",   "idx_transfer_events_event_type"),
    ("transfer_events",   "idx_transfer_events_created_at"),
    ("outbox_events",     "idx_outbox_events_aggregate_id"),
    ("outbox_events",     "idx_outbox_events_status"),
    ("balance_snapshots", "idx_balance_snapshots_wallet_id"),
    ("balance_snapshots", "idx_balance_snapshots_transfer_id"),
]

EXPECTED_CONSTRAINTS = {
    "wallets": [
        "chk_wallets_balance_non_negative",
        "chk_wallets_currency",
        "chk_wallets_status",
    ],
    "transfers": [
        "chk_transfers_amount_positive",
        "chk_transfers_currency",
        "chk_transfers_status",
        "chk_transfers_different_wallets",
    ],
    "outbox_events": [
        "chk_outbox_status",
    ],
}

# ─── Validation logic ─────────────────────────────────────────────────────────

failures = []


def fail(msg: str):
    failures.append(msg)
    print(f"  FAIL  {msg}")


def ok(msg: str):
    print(f"  OK    {msg}")


def check_tables(cursor):
    print("\n[1] Tables")
    cursor.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    """)
    existing = {row[0] for row in cursor.fetchall()}
    for table in EXPECTED_TABLES:
        if table in existing:
            ok(table)
        else:
            fail(f"Table '{table}' missing")


def check_columns(cursor):
    print("\n[2] Columns")
    cursor.execute("""
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
    """)
    existing = {}
    for table, col in cursor.fetchall():
        existing.setdefault(table, set()).add(col)

    for table, columns in EXPECTED_COLUMNS.items():
        table_cols = existing.get(table, set())
        for col in columns:
            if col in table_cols:
                ok(f"{table}.{col}")
            else:
                fail(f"Column '{table}.{col}' missing")


def check_indexes(cursor):
    print("\n[3] Indexes")
    cursor.execute("""
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
    """)
    existing = {row[0] for row in cursor.fetchall()}
    for _table, idx in EXPECTED_INDEXES:
        if idx in existing:
            ok(idx)
        else:
            fail(f"Index '{idx}' missing")


def check_constraints(cursor):
    print("\n[4] Check Constraints")
    cursor.execute("""
        SELECT constraint_name, table_name
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND constraint_type = 'CHECK'
    """)
    existing = {row[0] for row in cursor.fetchall()}
    for table, constraints in EXPECTED_CONSTRAINTS.items():
        for constraint in constraints:
            if constraint in existing:
                ok(f"{table}: {constraint}")
            else:
                fail(f"Constraint '{constraint}' missing on table '{table}'")


def check_balance_non_negative_enforced(conn, cursor):
    """Verify the CHECK constraint actually rejects negative balances."""
    print("\n[5] Constraint enforcement (negative balance rejection)")
    try:
        cursor.execute("""
            INSERT INTO wallets (owner_id, currency, balance)
            VALUES ('validate_schema_test', 'USD', -1.00)
        """)
        fail("Negative balance INSERT succeeded — CHECK constraint not enforced")
        conn.rollback()
    except psycopg2.errors.CheckViolation:
        ok("Negative balance correctly rejected by chk_wallets_balance_non_negative")
        conn.rollback()
    except Exception as e:
        fail(f"Unexpected error during negative balance check: {e}")
        conn.rollback()


def check_self_transfer_rejected(conn, cursor):
    """Verify different-wallets constraint rejects same source/destination."""
    print("\n[6] Constraint enforcement (self-transfer rejection)")
    try:
        cursor.execute("""
            INSERT INTO wallets (id, owner_id, currency, balance)
            VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test_owner', 'USD', 100.00)
            ON CONFLICT DO NOTHING
        """)
        cursor.execute("""
            INSERT INTO transfers
              (source_wallet_id, destination_wallet_id, amount, currency)
            VALUES
              ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               10.00, 'USD')
        """)