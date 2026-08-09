"""Wallet transfer service (test fixture / SUT).

Public endpoints:
    POST /transfers                      - create a transfer (header: Idempotency-Key)
    GET  /transfers/{transfer_id}        - fetch a transfer
    GET  /wallets/{wallet_id}            - fetch a wallet

Test-only hook (documented in README, would not exist in production):
    POST /transfers?force_fail=true      - simulate an in-flight failure so we can
                                           assert the failed-state persistence path
                                           without a real chaos-injection harness.

State machine:
    pending -> completed   (happy path)
    pending -> failed      (force_fail=true)

Rejected validation / insufficient balance / wallet-not-found returns 422 BEFORE
any row is written. The state machine only runs after pre-flight checks pass.

The service exposes its DB connection and side-effect stubs on the Flask app
object (`app.db`, `app.publisher`, `app.notifier`) so tests can assert directly
against persistence and side effects without poking at module-level state.
"""

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from flask import Flask, jsonify, request

from service.db import init_schema
from service.outbox import NotificationRecorder, StubPublisher

VALID_CURRENCIES: set[str] = {"AED", "USD", "EUR", "GBP"}
REQUIRED_FIELDS: tuple[str, ...] = (
    "source_wallet_id",
    "destination_wallet_id",
    "amount",
    "currency",
)
TERMINAL_STATUSES: set[str] = {"completed", "failed"}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _hash_payload(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        {k: payload[k] for k in sorted(payload)}, sort_keys=True, default=str
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _serialize_transfer(
    row: sqlite3.Row, idempotency_key: str | None
) -> dict[str, Any]:
    """Public API shape — internal fields like payload_hash never leak."""
    return {
        "id": row["id"],
        "source_wallet_id": row["source_wallet_id"],
        "destination_wallet_id": row["destination_wallet_id"],
        "amount": row["amount"],
        "currency": row["currency"],
        "reference": row["reference"],
        "status": row["status"],
        "idempotency_key": idempotency_key,
        "created_at": row["created_at"],
    }


def _err(message: str, status: int, **extra: Any):
    body: dict[str, Any] = {"error": message}
    body.update(extra)
    return jsonify(body), status


def create_app(db_path: str = ":memory:") -> Flask:
    app = Flask(__name__)

    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    init_schema(conn)

    publisher = StubPublisher()
    notifier = NotificationRecorder()
    write_lock = threading.Lock()

    app.db = conn  # type: ignore[attr-defined]
    app.publisher = publisher  # type: ignore[attr-defined]
    app.notifier = notifier  # type: ignore[attr-defined]
    app.write_lock = write_lock  # type: ignore[attr-defined]

    @app.get("/wallets/<wallet_id>")
    def get_wallet(wallet_id: str):
        row = conn.execute(
            "SELECT id, balance, currency FROM wallets WHERE id = ?",
            (wallet_id,),
        ).fetchone()
        if row is None:
            return _err("wallet not found", 404)
        return jsonify(dict(row)), 200

    @app.get("/transfers/<transfer_id>")
    def get_transfer(transfer_id: str):
        row = conn.execute(
            "SELECT * FROM transfers WHERE id = ?",
            (transfer_id,),
        ).fetchone()
        if row is None:
            return _err("transfer not found", 404)
        idem = conn.execute(
            "SELECT key FROM idempotency_keys WHERE transfer_id = ?",
            (transfer_id,),
        ).fetchone()
        return jsonify(_serialize_transfer(row, idem["key"] if idem else None)), 200

    @app.post("/transfers")
    def create_transfer():
        idempotency_key = request.headers.get("Idempotency-Key")
        force_fail = request.args.get("force_fail", "").lower() == "true"
        data = request.get_json(silent=True) or {}

        # ── Pre-flight validation (422). No DB writes on any of these paths. ──
        missing = [f for f in REQUIRED_FIELDS if f not in data]
        if missing:
            return _err("missing fields", 422, fields=missing)

        source_id = data["source_wallet_id"]
        dest_id = data["destination_wallet_id"]
        amount = data["amount"]
        currency = data["currency"]
        reference = data.get("reference")

        if not isinstance(source_id, str) or not isinstance(dest_id, str):
            return _err("wallet ids must be strings", 422)
        if not isinstance(currency, str) or currency not in VALID_CURRENCIES:
            return _err("invalid currency", 422)
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            return _err("amount must be a positive integer", 422)
        if source_id == dest_id:
            return _err("source and destination must differ", 422)

        payload_hash = _hash_payload(
            {
                "source_wallet_id": source_id,
                "destination_wallet_id": dest_id,
                "amount": amount,
                "currency": currency,
                "reference": reference,
            }
        )

        # ── Single-writer section: idempotency lookup + state machine + persistence ──
        with write_lock:
            if idempotency_key:
                existing = conn.execute(
                    "SELECT transfer_id, payload_hash"
                    " FROM idempotency_keys WHERE key = ?",
                    (idempotency_key,),
                ).fetchone()
                if existing is not None:
                    if existing["payload_hash"] != payload_hash:
                        return _err("idempotency key conflict", 409)
                    replay_row = conn.execute(
                        "SELECT * FROM transfers WHERE id = ?",
                        (existing["transfer_id"],),
                    ).fetchone()
                    return (
                        jsonify(_serialize_transfer(replay_row, idempotency_key)),
                        200,
                    )

            source = conn.execute(
                "SELECT id, balance, currency FROM wallets WHERE id = ?",
                (source_id,),
            ).fetchone()
            dest = conn.execute(
                "SELECT id, currency FROM wallets WHERE id = ?",
                (dest_id,),
            ).fetchone()

            if source is None:
                return _err("source wallet not found", 422)
            if dest is None:
                return _err("destination wallet not found", 422)
            if source["currency"] != currency:
                return _err("source wallet currency mismatch", 422)
            if dest["currency"] != currency:
                return _err("destination wallet currency mismatch", 422)
            if source["balance"] < amount:
                return _err("insufficient balance", 422)

            # ── State machine: PENDING -> {COMPLETED, FAILED} ──
            transfer_id = str(uuid.uuid4())
            pending_at = _now_iso()
            conn.execute(
                "INSERT INTO transfers"
                " (id, source_wallet_id, destination_wallet_id, amount, currency,"
                "  reference, status, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
                (
                    transfer_id,
                    source_id,
                    dest_id,
                    amount,
                    currency,
                    reference,
                    pending_at,
                    pending_at,
                ),
            )
            conn.execute(
                "INSERT INTO transfer_events"
                " (id, transfer_id, event_type, payload, created_at)"
                " VALUES (?, ?, 'transfer_pending', ?, ?)",
                (
                    str(uuid.uuid4()),
                    transfer_id,
                    json.dumps({"amount": amount, "currency": currency}),
                    pending_at,
                ),
            )

            if force_fail:
                final_status = "failed"
            else:
                conn.execute(
                    "UPDATE wallets SET balance = balance - ? WHERE id = ?",
                    (amount, source_id),
                )
                conn.execute(
                    "UPDATE wallets SET balance = balance + ? WHERE id = ?",
                    (amount, dest_id),
                )
                final_status = "completed"

            transition_at = _now_iso()
            conn.execute(
                "UPDATE transfers SET status = ?, updated_at = ? WHERE id = ?",
                (final_status, transition_at, transfer_id),
            )
            conn.execute(
                "INSERT INTO transfer_events"
                " (id, transfer_id, event_type, payload, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    transfer_id,
                    f"transfer_{final_status}",
                    json.dumps({"amount": amount, "currency": currency}),
                    transition_at,
                ),
            )

            # Idempotency row written for BOTH completed and failed terminal states,
            # so a replay with the same key returns the same outcome (including failure).
            if idempotency_key:
                conn.execute(
                    "INSERT INTO idempotency_keys"
                    " (key, transfer_id, payload_hash, created_at)"
                    " VALUES (?, ?, ?, ?)",
                    (idempotency_key, transfer_id, payload_hash, transition_at),
                )

            # Outbox row only on success. Failed transfers do not emit business
            # events; the failed transfer row + failure audit event are the
            # DLQ-equivalent persistence artifacts.
            if final_status == "completed":
                event_payload = json.dumps(
                    {
                        "transfer_id": transfer_id,
                        "source_wallet_id": source_id,
                        "destination_wallet_id": dest_id,
                        "amount": amount,
                        "currency": currency,
                    }
                )
                conn.execute(
                    "INSERT INTO outbox_events"
                    " (id, transfer_id, event_type, payload, published, created_at)"
                    " VALUES (?, ?, 'transfer_completed', ?, 0, ?)",
                    (str(uuid.uuid4()), transfer_id, event_payload, transition_at),
                )

            conn.commit()

            # Side effects AFTER commit, only on success. In-process stubs stand
            # in for a real broker / notification service.
            if final_status == "completed":
                event = {
                    "transfer_id": transfer_id,
                    "type": "transfer_completed",
                    "amount": amount,
                    "currency": currency,
                }
                publisher.publish(event)
                notifier.notify(transfer_id, event)
                conn.execute(
                    "UPDATE outbox_events SET published = 1 WHERE transfer_id = ?",
                    (transfer_id,),
                )
                conn.commit()

            final_row = conn.execute(
                "SELECT * FROM transfers WHERE id = ?",
                (transfer_id,),
            ).fetchone()

        return jsonify(_serialize_transfer(final_row, idempotency_key)), 201

    return app
