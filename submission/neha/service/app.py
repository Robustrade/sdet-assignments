"""Minimal wallet transfer service fixture for multi-layer automated testing.

Option 2/3 hybrid: a real SQLite-backed transfer API with in-process
persistence for wallets, transfers, idempotency keys, audit events, and
outbox events. Surrounding message brokers are not run; outbox rows stand
in for publish-once side effects.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify, request

VALID_CURRENCIES = {"AED", "USD", "EUR", "GBP"}

# Shared mutex so concurrent requests against one app cannot race the DB.
_db_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_payload(data: dict) -> str:
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS wallets (
            id       TEXT    PRIMARY KEY,
            balance  INTEGER NOT NULL CHECK(balance >= 0),
            currency TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transfers (
            id                    TEXT    PRIMARY KEY,
            source_wallet_id      TEXT    NOT NULL,
            destination_wallet_id TEXT    NOT NULL,
            amount                INTEGER NOT NULL,
            currency              TEXT    NOT NULL,
            reference             TEXT,
            status                TEXT    NOT NULL,
            created_at            TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS idempotency_keys (
            key          TEXT PRIMARY KEY,
            payload_hash TEXT NOT NULL,
            transfer_id  TEXT NOT NULL,
            created_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id          TEXT PRIMARY KEY,
            transfer_id TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS outbox_events (
            id          TEXT PRIMARY KEY,
            transfer_id TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT NOT NULL,
            status      TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        """
    )
    conn.commit()


def create_app(db_path: str = ":memory:") -> Flask:
    app = Flask(__name__)

    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    init_schema(conn)
    app.db = conn  # type: ignore[attr-defined]

    def _transfer_response(transfer_id: str):
        row = conn.execute(
            "SELECT id, source_wallet_id, destination_wallet_id, amount, currency,"
            " reference, status, created_at FROM transfers WHERE id = ?",
            (transfer_id,),
        ).fetchone()
        return dict(row)

    @app.get("/wallets/<wallet_id>")
    def get_wallet(wallet_id: str):
        row = conn.execute(
            "SELECT id, balance, currency FROM wallets WHERE id = ?",
            (wallet_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "wallet not found"}), 404
        return jsonify(dict(row)), 200

    @app.get("/transfers/<transfer_id>")
    def get_transfer(transfer_id: str):
        row = conn.execute(
            "SELECT id, source_wallet_id, destination_wallet_id, amount, currency,"
            " reference, status, created_at FROM transfers WHERE id = ?",
            (transfer_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "transfer not found"}), 404
        return jsonify(dict(row)), 200

    @app.post("/transfers")
    def create_transfer():
        idempotency_key = request.headers.get("Idempotency-Key")
        data = request.get_json(silent=True) or {}

        required = [
            "source_wallet_id",
            "destination_wallet_id",
            "amount",
            "currency",
        ]
        missing = [field for field in required if field not in data]
        if missing:
            return jsonify({"error": "missing fields", "fields": missing}), 422

        source_id = data["source_wallet_id"]
        dest_id = data["destination_wallet_id"]
        amount = data["amount"]
        currency = data["currency"]
        reference = data.get("reference")

        if not isinstance(currency, str) or currency not in VALID_CURRENCIES:
            return jsonify({"error": "invalid currency"}), 422
        if not isinstance(amount, (int, float)) or isinstance(amount, bool):
            return jsonify({"error": "amount must be positive"}), 422
        if amount <= 0:
            return jsonify({"error": "amount must be positive"}), 422
        if source_id == dest_id:
            return jsonify({"error": "source and destination must differ"}), 422

        amount = int(amount)
        payload_hash = _hash_payload(
            {
                "amount": amount,
                "currency": currency,
                "destination_wallet_id": dest_id,
                "reference": reference,
                "source_wallet_id": source_id,
            }
        )

        with _db_lock:
            if idempotency_key:
                existing = conn.execute(
                    "SELECT key, payload_hash, transfer_id"
                    " FROM idempotency_keys WHERE key = ?",
                    (idempotency_key,),
                ).fetchone()
                if existing is not None:
                    if existing["payload_hash"] != payload_hash:
                        return jsonify({"error": "idempotency key conflict"}), 409
                    body = _transfer_response(existing["transfer_id"])
                    body["idempotency_key"] = idempotency_key
                    return jsonify(body), 200

            source = conn.execute(
                "SELECT id, balance, currency FROM wallets WHERE id = ?",
                (source_id,),
            ).fetchone()
            dest = conn.execute(
                "SELECT id, currency FROM wallets WHERE id = ?",
                (dest_id,),
            ).fetchone()

            if source is None:
                return jsonify({"error": "source wallet not found"}), 422
            if dest is None:
                return jsonify({"error": "destination wallet not found"}), 422
            if source["currency"] != currency or dest["currency"] != currency:
                return jsonify({"error": "currency mismatch"}), 422
            if source["balance"] < amount:
                return jsonify({"error": "insufficient balance"}), 422

            transfer_id = str(uuid.uuid4())
            now = _utc_now()

            conn.execute(
                "UPDATE wallets SET balance = balance - ? WHERE id = ?",
                (amount, source_id),
            )
            conn.execute(
                "UPDATE wallets SET balance = balance + ? WHERE id = ?",
                (amount, dest_id),
            )
            conn.execute(
                "INSERT INTO transfers"
                " (id, source_wallet_id, destination_wallet_id, amount, currency,"
                "  reference, status, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    transfer_id,
                    source_id,
                    dest_id,
                    amount,
                    currency,
                    reference,
                    "completed",
                    now,
                ),
            )

            if idempotency_key:
                conn.execute(
                    "INSERT INTO idempotency_keys"
                    " (key, payload_hash, transfer_id, created_at)"
                    " VALUES (?, ?, ?, ?)",
                    (idempotency_key, payload_hash, transfer_id, now),
                )

            event_payload = json.dumps(
                {
                    "amount": amount,
                    "currency": currency,
                    "destination_wallet_id": dest_id,
                    "source_wallet_id": source_id,
                    "transfer_id": transfer_id,
                }
            )
            conn.execute(
                "INSERT INTO audit_events"
                " (id, transfer_id, event_type, payload, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    transfer_id,
                    "transfer_completed",
                    event_payload,
                    now,
                ),
            )
            conn.execute(
                "INSERT INTO outbox_events"
                " (id, transfer_id, event_type, payload, status, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    transfer_id,
                    "wallet.transfer.completed",
                    event_payload,
                    "pending",
                    now,
                ),
            )
            conn.commit()

            body = _transfer_response(transfer_id)
            body["idempotency_key"] = idempotency_key
            return jsonify(body), 201

    return app
