"""
Persistence models for the Wallet Transfer Service fixture.

This is a MINIMAL service built only to give the test suite something real
to exercise. It is intentionally simple: no framework-level auth, no
migrations tooling, no production concerns. See docs/TEST_STRATEGY.md for
what is "real" vs "stubbed" in this assignment.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    Integer,
    BigInteger,
    DateTime,
    Boolean,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(String, primary_key=True)
    currency = Column(String(3), nullable=False)
    # balance stored in minor units (cents/fils) as an integer to avoid
    # floating point rounding issues in a financial ledger.
    balance = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


class Transfer(Base):
    __tablename__ = "transfers"

    id = Column(String, primary_key=True, default=_uuid)
    source_wallet_id = Column(String, ForeignKey("wallets.id"), nullable=False)
    destination_wallet_id = Column(String, ForeignKey("wallets.id"), nullable=False)
    amount = Column(BigInteger, nullable=False)
    currency = Column(String(3), nullable=False)
    reference = Column(String, nullable=True)
    idempotency_key = Column(String, nullable=False, index=True)
    # COMPLETED | REJECTED
    status = Column(String, nullable=False)
    failure_reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


class IdempotencyKey(Base):
    """
    Maps an Idempotency-Key header to the request that first used it, and to
    the transfer that resulted from it (if any). This is what makes replay
    detection and "same key / different payload" conflict detection possible.
    """

    __tablename__ = "idempotency_keys"

    key = Column(String, primary_key=True)
    request_hash = Column(String, nullable=False)
    transfer_id = Column(String, ForeignKey("transfers.id"), nullable=True)
    response_status_code = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


class TransferEvent(Base):
    """Append-only audit/event log for a transfer's lifecycle."""

    __tablename__ = "transfer_events"

    id = Column(String, primary_key=True, default=_uuid)
    transfer_id = Column(String, ForeignKey("transfers.id"), nullable=False)
    event_type = Column(String, nullable=False)  # CREATED | COMPLETED | REJECTED
    detail = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


class OutboxEvent(Base):
    """
    Transactional outbox row. In a real system a separate publisher process
    would poll `published=False` rows and emit them to a message broker,
    then flip `published=True`. Here we simulate the publish step inline
    (see app/publisher.py) but keep the table so tests can assert exactly-once
    semantics independent of the API response.
    """

    __tablename__ = "outbox_events"

    id = Column(String, primary_key=True, default=_uuid)
    transfer_id = Column(String, ForeignKey("transfers.id"), nullable=False)
    event_type = Column(String, nullable=False)  # transfer.completed | transfer.rejected
    published = Column(Boolean, nullable=False, default=False)
    publish_attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)
    published_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # Guarantees at most one outbox row per (transfer, event_type) at the
        # DB level -- a defense-in-depth invariant, not just an app-level check.
        UniqueConstraint("transfer_id", "event_type", name="uq_outbox_transfer_event"),
    )
