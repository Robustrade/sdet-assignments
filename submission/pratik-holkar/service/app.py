"""Wallet transfer service used as the SUT for the test suite.

Backed by SQLite, but written so the transactional / concurrency tests
actually exercise locking instead of bouncing off a Python mutex.

Each request opens its own SQLite connection against a shared in-memory
database (file::memory:?cache=shared URI). The hot path opens a
BEGIN IMMEDIATE transaction and retries on `database is locked` with
exponential backoff, which is the closest SQLite gets to a SERIALIZABLE
write path.

Schema lives in five tables:
    wallets             owner_id, currency, balance (in minor units)
    transfers           state machine: pending -> completed | failed
    idempotency_keys    key -> (request_hash, transfer_id) mapping
    ledger_entries      double-entry: every completed transfer writes
                        one debit row and one credit row, and the
                        two amounts always match
    outbox              one row per completed transfer, unpublished
"""

import hashlib
import json
import random
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from flask import Flask, jsonify, request

SUPPORTED_CURRENCIES = ("USD", "EUR", "GBP", "AED", "INR")
MIN_AMOUNT_MINOR = 1
MAX_AMOUNT_MINOR = 1_000_000_000

# BEGIN IMMEDIATE retry policy. SQLite raises OperationalError("database
# is locked") when two writers race; we back off with jitter and retry.
TXN_MAX_RETRIES = 8
TXN_BACKOFF_BASE_S = 0.002


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS wallets (
    wallet_id     TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL,
    currency      TEXT NOT NULL,
    balance_minor INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    CHECK (balance_minor >= 0)
);

CREATE TABLE IF NOT EXISTS transfers (
    transfer_id      TEXT PRIMARY KEY,
    source_wallet_id TEXT NOT NULL,
    dest_wallet_id   TEXT NOT NULL,
    amount_minor     INTEGER NOT NULL,
    currency         TEXT NOT NULL,
    reference        TEXT,
    status           TEXT NOT NULL,
    failure_reason   TEXT,
    created_at       TEXT NOT NULL,
    completed_at     TEXT,
    CHECK (amount_minor > 0),
    CHECK (status IN ('pending','completed','failed'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    idem_key     TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    transfer_id  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    entry_id            TEXT PRIMARY KEY,
    transfer_id         TEXT NOT NULL,
    wallet_id           TEXT NOT NULL,
    direction           TEXT NOT NULL,
    amount_minor        INTEGER NOT NULL,
    balance_after_minor INTEGER NOT NULL,
    created_at          TEXT NOT NULL,
    CHECK (direction IN ('debit','credit'))
);

CREATE TABLE IF NOT EXISTS outbox (
    event_id     TEXT PRIMARY KEY,
    aggregate_id TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    payload      TEXT NOT NULL,
    published    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS ix_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS ix_ledger_transfer ON ledger_entries(transfer_id);
"""


def init_schema(conn):
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _fingerprint(d):
    canon = json.dumps({k: d[k] for k in sorted(d)}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def _validate(data):
    """Return (error_dict, http_status) or (None, None) if payload is OK."""
    required = ("source_wallet_id", "dest_wallet_id", "amount_minor", "currency")
    missing = [f for f in required if f not in data]
    if missing:
        return {"error": "missing_fields", "fields": missing}, 422

    amt = data["amount_minor"]
    # bools are ints in Python; explicitly reject them
    if not isinstance(amt, int) or isinstance(amt, bool):
        return {"error": "invalid_amount", "reason": "must be integer minor units"}, 422
    if amt < MIN_AMOUNT_MINOR or amt > MAX_AMOUNT_MINOR:
        return {"error": "invalid_amount", "reason": "out of range"}, 422

    if data["currency"] not in SUPPORTED_CURRENCIES:
        return {"error": "unsupported_currency"}, 422

    if data["source_wallet_id"] == data["dest_wallet_id"]:
        return {"error": "same_wallet"}, 422

    return None, None


@contextmanager
def _write_txn(conn):
    """BEGIN IMMEDIATE with bounded retry. Raises if it can't get the lock."""
    last_err = None
    for attempt in range(TXN_MAX_RETRIES):
        try:
            conn.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as e:
            last_err = e
            if "locked" not in str(e).lower() and "busy" not in str(e).lower():
                raise
            time.sleep(TXN_BACKOFF_BASE_S * (2**attempt) + random.uniform(0, 0.002))
            continue
        try:
            yield
            conn.commit()
            return
        except Exception:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            raise
    raise last_err  # exhausted retries


def _row_to_transfer_dict(row):
    return {
        "transfer_id": row["transfer_id"],
        "source_wallet_id": row["source_wallet_id"],
        "dest_wallet_id": row["dest_wallet_id"],
        "amount_minor": row["amount_minor"],
        "currency": row["currency"],
        "reference": row["reference"],
        "status": row["status"],
        "failure_reason": row["failure_reason"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
    }


def _connect(db_uri, is_uri):
    """Open a fresh connection with the pragmas we need for write-side work."""
    c = sqlite3.connect(db_uri, uri=is_uri, check_same_thread=False, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=2000")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def create_app(db_uri=None):
    """Build a Flask app backed by SQLite.

    If db_uri is None, a unique shared in-memory database is created
    (file::memory:?cache=shared style) so the same DB can be opened by
    multiple connections in the same process - which is what makes the
    concurrency tests meaningful.
    """
    is_uri = True
    if db_uri is None:
        db_uri = f"file:wallet_{uuid.uuid4().hex}?mode=memory&cache=shared"
    elif db_uri == ":memory:" or not db_uri.startswith("file:"):
        # caller passed a plain path - use it as a file DB
        is_uri = False

    app = Flask(__name__)
    app.db_uri = db_uri  # type: ignore[attr-defined]
    app.db_is_uri = is_uri  # type: ignore[attr-defined]

    # Master connection - keeps the in-memory DB alive AND lets tests
    # query state directly without going through HTTP.
    master = _connect(db_uri, is_uri)
    init_schema(master)
    app.db = master  # type: ignore[attr-defined]

    @app.get("/wallets/<wallet_id>")
    def get_wallet(wallet_id):
        row = master.execute(
            "SELECT wallet_id, owner_id, currency, balance_minor, created_at "
            "FROM wallets WHERE wallet_id = ?",
            (wallet_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "wallet_not_found"}), 404
        return jsonify(dict(row)), 200

    @app.get("/transfers/<transfer_id>")
    def get_transfer(transfer_id):
        row = master.execute(
            "SELECT * FROM transfers WHERE transfer_id = ?", (transfer_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "transfer_not_found"}), 404
        return jsonify(_row_to_transfer_dict(row)), 200

    @app.post("/transfers")
    def create_transfer():
        idem_key = request.headers.get("Idempotency-Key")
        data = request.get_json(silent=True) or {}

        err, code = _validate(data)
        if err is not None:
            return jsonify(err), code

        src = data["source_wallet_id"]
        dst = data["dest_wallet_id"]
        amount = int(data["amount_minor"])
        currency = data["currency"]
        reference = data.get("reference")

        req_hash = _fingerprint(
            {
                "src": src,
                "dst": dst,
                "amount": amount,
                "currency": currency,
                "reference": reference,
            }
        )

        c = _connect(db_uri, is_uri)
        try:
            try:
                with _write_txn(c):
                    # Idempotency fast-path
                    if idem_key:
                        existing = c.execute(
                            "SELECT request_hash, transfer_id "
                            "FROM idempotency_keys WHERE idem_key = ?",
                            (idem_key,),
                        ).fetchone()
                        if existing is not None:
                            if existing["request_hash"] != req_hash:
                                return jsonify({"error": "idempotency_key_conflict"}), 409
                            replay = c.execute(
                                "SELECT * FROM transfers WHERE transfer_id = ?",
                                (existing["transfer_id"],),
                            ).fetchone()
                            return jsonify(_row_to_transfer_dict(replay)), 200

                    src_row = c.execute(
                        "SELECT currency, balance_minor FROM wallets WHERE wallet_id = ?",
                        (src,),
                    ).fetchone()
                    dst_row = c.execute(
                        "SELECT currency, balance_minor FROM wallets WHERE wallet_id = ?",
                        (dst,),
                    ).fetchone()

                    if src_row is None:
                        return jsonify({"error": "source_wallet_not_found"}), 422
                    if dst_row is None:
                        return jsonify({"error": "destination_wallet_not_found"}), 422
                    if src_row["currency"] != currency or dst_row["currency"] != currency:
                        return jsonify({"error": "currency_mismatch"}), 422
                    if src_row["balance_minor"] < amount:
                        return jsonify({"error": "insufficient_balance"}), 422

                    transfer_id = str(uuid.uuid4())
                    now = _now_iso()
                    new_src = src_row["balance_minor"] - amount
                    new_dst = dst_row["balance_minor"] + amount

                    c.execute(
                        "UPDATE wallets SET balance_minor = ? WHERE wallet_id = ?",
                        (new_src, src),
                    )
                    c.execute(
                        "UPDATE wallets SET balance_minor = ? WHERE wallet_id = ?",
                        (new_dst, dst),
                    )

                    c.execute(
                        "INSERT INTO transfers (transfer_id, source_wallet_id, "
                        "dest_wallet_id, amount_minor, currency, reference, status, "
                        "created_at, completed_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)",
                        (transfer_id, src, dst, amount, currency, reference, now, now),
                    )

                    # double-entry ledger - debit + credit per transfer
                    c.execute(
                        "INSERT INTO ledger_entries VALUES " "(?, ?, ?, 'debit', ?, ?, ?)",
                        (str(uuid.uuid4()), transfer_id, src, amount, new_src, now),
                    )
                    c.execute(
                        "INSERT INTO ledger_entries VALUES " "(?, ?, ?, 'credit', ?, ?, ?)",
                        (str(uuid.uuid4()), transfer_id, dst, amount, new_dst, now),
                    )

                    # outbox row, never published in this fixture
                    c.execute(
                        "INSERT INTO outbox VALUES (?, ?, 'transfer.completed', ?, 0, ?)",
                        (
                            str(uuid.uuid4()),
                            transfer_id,
                            json.dumps(
                                {
                                    "transfer_id": transfer_id,
                                    "amount_minor": amount,
                                    "currency": currency,
                                    "src": src,
                                    "dst": dst,
                                },
                                separators=(",", ":"),
                            ),
                            now,
                        ),
                    )

                    if idem_key:
                        c.execute(
                            "INSERT INTO idempotency_keys VALUES (?, ?, ?, ?)",
                            (idem_key, req_hash, transfer_id, now),
                        )

                    row = c.execute(
                        "SELECT * FROM transfers WHERE transfer_id = ?",
                        (transfer_id,),
                    ).fetchone()
                    return jsonify(_row_to_transfer_dict(row)), 201
            except sqlite3.IntegrityError as e:
                # Another writer claimed the idempotency key while we were
                # mid-write. Re-read using the master connection.
                if "idem_key" not in str(e):
                    raise
                replay = master.execute(
                    "SELECT t.* FROM transfers t "
                    "JOIN idempotency_keys k ON k.transfer_id = t.transfer_id "
                    "WHERE k.idem_key = ?",
                    (idem_key,),
                ).fetchone()
                if replay is not None:
                    return jsonify(_row_to_transfer_dict(replay)), 200
                raise
        finally:
            c.close()

    return app
