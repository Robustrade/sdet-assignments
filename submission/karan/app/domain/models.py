from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class Base(DeclarativeBase):
    pass


@dataclass(frozen=True)
class Plan:
    code: str
    price: int
    currency: str
    trial_days: int


class PlanCatalog:
    _plans = {
        "basic": Plan("basic", 2900, "USD", 7),
        "pro": Plan("pro", 4900, "USD", 0),
    }

    def get(self, code: str) -> Plan:
        try:
            return self._plans[code]
        except KeyError as exc:
            raise ValueError(f"Unknown plan: {code}") from exc


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("sub"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    plan: Mapped[str] = mapped_column(String)
    payment_method_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("inv"))
    subscription_id: Mapped[str] = mapped_column(ForeignKey("subscriptions.id"))
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    attempt_number: Mapped[int] = mapped_column(Integer)
    provider_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("pay"))
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id"))
    subscription_id: Mapped[str] = mapped_column(ForeignKey("subscriptions.id"))
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    provider_reference: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("wh"))
    event_id: Mapped[str] = mapped_column(String, unique=True)
    type: Mapped[str] = mapped_column(String)
    subscription_id: Mapped[str] = mapped_column(String)
    invoice_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("audit"))
    subscription_id: Mapped[str] = mapped_column(ForeignKey("subscriptions.id"))
    event_type: Mapped[str] = mapped_column(String)
    from_status: Mapped[str] = mapped_column(String)
    to_status: Mapped[str] = mapped_column(String)
    reference_id: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
