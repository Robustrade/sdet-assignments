"""
Minimal Wallet Transfer Service fixture.

This exists ONLY to give the automated test suite a real, deterministic
system to validate. It deliberately implements the "hard parts" called out
in the assignment (idempotency, balance invariants, outbox, audit log,
concurrency safety) but skips everything not relevant to proving test
strategy (auth, multi-currency FX, pagination, etc).

Concurrency strategy (documented, see docs/TEST_STRATEGY.md):
  SQLite does not give us real row-level locking, so this fixture uses an
  in-process lock keyed by the *pair* of wallets involved, combined with a
  SQLite IMMEDIATE transaction. This is sufficient to prove the test suite
  can detect double-debit/double-credit races, but it is explicitly NOT the
  concurrency control a production service would use (that would be
  DB-level SELECT ... FOR UPDATE / optimistic version columns).
"""
from __future__ import annotations

import hashlib
import json
import threading
from collections import defaultdict
from typing import Optional

from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db import SessionLocal, init_db, db_write_lock
from app.models import Wallet, Transfer, IdempotencyKey, TransferEvent, OutboxEvent


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Wallet Transfer Service (test fixture)", lifespan=lifespan)

# One lock per unordered wallet pair, so two transfers that touch
# unrelated wallets can proceed concurrently, but two transfers touching
# the same wallet(s) are serialized -- this is what makes the
# insufficient-balance-under-concurrency invariant enforceable.
_wallet_pair_locks: dict[tuple[str, str], threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _lock_for(a: str, b: str) -> threading.Lock:
    key = tuple(sorted([a, b]))
    with _locks_guard:
        return _wallet_pair_locks[key]


def get_db():
    db_write_lock.acquire()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        db_write_lock.release()


class TransferRequest(BaseModel):
    source_wallet_id: str
    destination_wallet_id: str
    amount: int = Field(..., description="Amount in minor units (e.g. fils/cents)")
    currency: str
    reference: Optional[str] = None

    @field_validator("currency")
    @classmethod
    def currency_must_be_iso_like(cls, v):
        if not isinstance(v, str) or len(v) != 3 or not v.isalpha() or not v.isupper():
            raise ValueError("currency must be a 3-letter uppercase ISO 4217 code")
        return v

    @field_validator("amount")
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("amount must be a positive integer (minor units)")
        return v


def _request_hash(body: TransferRequest) -> str:
    canonical = json.dumps(body.model_dump(), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _transfer_to_response(t: Transfer) -> dict:
    return {
        "transfer_id": t.id,
        "source_wallet_id": t.source_wallet_id,
        "destination_wallet_id": t.destination_wallet_id,
        "amount": t.amount,
        "currency": t.currency,
        "reference": t.reference,
        "status": t.status,
        "failure_reason": t.failure_reason,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@app.post("/transfers", status_code=201)
def create_transfer(
    body: TransferRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    if not idempotency_key or len(idempotency_key) < 8:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required and must be a valid key")

    if body.source_wallet_id == body.destination_wallet_id:
        raise HTTPException(status_code=422, detail="source_wallet_id and destination_wallet_id must differ")

    incoming_hash = _request_hash(body)

    # --- Idempotency check (pre-lock fast path) ---
    existing_key = db.get(IdempotencyKey, idempotency_key)
    if existing_key is not None:
        if existing_key.request_hash != incoming_hash:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key was already used with a different request payload",
            )
        # Exact replay: return the original logical result, don't redo side effects.
        transfer = db.get(Transfer, existing_key.transfer_id)
        status_code = existing_key.response_status_code or 201
        return _json_response(status_code, _transfer_to_response(transfer))

    lock = _lock_for(body.source_wallet_id, body.destination_wallet_id)
    with lock:
        # Re-check idempotency inside the lock: another thread may have
        # created the record for this exact key while we were waiting.
        db.rollback()
        existing_key = db.get(IdempotencyKey, idempotency_key)
        if existing_key is not None:
            if existing_key.request_hash != incoming_hash:
                raise HTTPException(status_code=409, detail="Idempotency-Key was already used with a different request payload")
            transfer = db.get(Transfer, existing_key.transfer_id)
            status_code = existing_key.response_status_code or 201
            return _json_response(status_code, _transfer_to_response(transfer))

        source = db.get(Wallet, body.source_wallet_id)
        destination = db.get(Wallet, body.destination_wallet_id)
        if source is None or destination is None:
            raise HTTPException(status_code=404, detail="source or destination wallet does not exist")
        if source.currency != body.currency or destination.currency != body.currency:
            raise HTTPException(status_code=422, detail="currency does not match wallet currency")

        if source.balance < body.amount:
            transfer = Transfer(
                source_wallet_id=body.source_wallet_id,
                destination_wallet_id=body.destination_wallet_id,
                amount=body.amount,
                currency=body.currency,
                reference=body.reference,
                idempotency_key=idempotency_key,
                status="REJECTED",
                failure_reason="INSUFFICIENT_BALANCE",
            )
            db.add(transfer)
            db.flush()
            db.add(TransferEvent(transfer_id=transfer.id, event_type="REJECTED", detail="insufficient_balance"))
            db.add(IdempotencyKey(
                key=idempotency_key, request_hash=incoming_hash,
                transfer_id=transfer.id, response_status_code=422,
            ))
            db.add(OutboxEvent(transfer_id=transfer.id, event_type="transfer.rejected"))
            db.commit()
            return _json_response(422, _transfer_to_response(transfer))

        # Happy path: debit / credit / persist / audit / outbox, all in one
        # local transaction so a crash mid-way leaves nothing half-written.
        source.balance -= body.amount
        destination.balance += body.amount

        transfer = Transfer(
            source_wallet_id=body.source_wallet_id,
            destination_wallet_id=body.destination_wallet_id,
            amount=body.amount,
            currency=body.currency,
            reference=body.reference,
            idempotency_key=idempotency_key,
            status="COMPLETED",
        )
        db.add(transfer)
        db.flush()

        db.add(TransferEvent(transfer_id=transfer.id, event_type="CREATED", detail="transfer accepted"))
        db.add(TransferEvent(transfer_id=transfer.id, event_type="COMPLETED", detail="funds moved"))
        db.add(OutboxEvent(transfer_id=transfer.id, event_type="transfer.completed"))
        db.add(IdempotencyKey(
            key=idempotency_key, request_hash=incoming_hash,
            transfer_id=transfer.id, response_status_code=201,
        ))
        db.commit()
        return _json_response(201, _transfer_to_response(transfer))


@app.get("/transfers/{transfer_id}")
def get_transfer(transfer_id: str, db: Session = Depends(get_db)):
    transfer = db.get(Transfer, transfer_id)
    if transfer is None:
        raise HTTPException(status_code=404, detail="transfer not found")
    return _transfer_to_response(transfer)


@app.get("/wallets/{wallet_id}")
def get_wallet(wallet_id: str, db: Session = Depends(get_db)):
    wallet = db.get(Wallet, wallet_id)
    if wallet is None:
        raise HTTPException(status_code=404, detail="wallet not found")
    return {
        "wallet_id": wallet.id,
        "currency": wallet.currency,
        "balance": wallet.balance,
    }


def _json_response(status_code: int, payload: dict):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=status_code, content=payload)
