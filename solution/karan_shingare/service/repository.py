import json
import sqlite3
from typing import Optional

from service.models import Subscription, Invoice

SCHEMA: str = """
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_method_id TEXT NOT NULL,
    trial_end TEXT,
    created_at TEXT NOT NULL,
    canceled_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_reference TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
    event_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subscription_id TEXT,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE TABLE subscription_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    created_at TEXT NOT NULL
);
"""


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


class CustomerRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create(self, customer_id: str, name: str) -> None:
        self._conn.execute("INSERT INTO customers (id, name) VALUES (?, ?)", (customer_id, name))
        self._conn.commit()

    def exists(self, customer_id: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone()
        return row is not None


class SubscriptionRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create(self, sub: Subscription) -> None:
        self._conn.execute(
            """INSERT INTO subscriptions
               (id, customer_id, plan, status, payment_method_id, trial_end, created_at, canceled_at, retry_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sub.id, sub.customer_id, sub.plan, sub.status, sub.payment_method_id,
             sub.trial_end, sub.created_at, sub.canceled_at, sub.retry_count),
        )
        self._conn.commit()

    def get(self, sub_id: str) -> Optional[Subscription]:
        row = self._conn.execute("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)).fetchone()
        return self._to_model(row) if row else None

    def update_status(self, sub_id: str, status: str, canceled_at: Optional[str] = None) -> None:
        if canceled_at is not None:
            self._conn.execute(
                "UPDATE subscriptions SET status = ?, canceled_at = ? WHERE id = ?",
                (status, canceled_at, sub_id),
            )
        else:
            self._conn.execute("UPDATE subscriptions SET status = ? WHERE id = ?", (status, sub_id))
        self._conn.commit()

    def increment_retry(self, sub_id: str) -> None:
        self._conn.execute("UPDATE subscriptions SET retry_count = retry_count + 1 WHERE id = ?", (sub_id,))
        self._conn.commit()

    def count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0]

    @staticmethod
    def _to_model(row: sqlite3.Row) -> Subscription:
        return Subscription(
            id=row["id"], customer_id=row["customer_id"], plan=row["plan"], status=row["status"],
            payment_method_id=row["payment_method_id"], trial_end=row["trial_end"],
            created_at=row["created_at"], canceled_at=row["canceled_at"], retry_count=row["retry_count"],
        )


class InvoiceRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create(self, invoice: Invoice) -> None:
        self._conn.execute(
            """INSERT INTO invoices (id, subscription_id, amount, currency, status, provider_reference, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (invoice.id, invoice.subscription_id, invoice.amount, invoice.currency,
             invoice.status, invoice.provider_reference, invoice.created_at),
        )
        self._conn.commit()

    def get(self, invoice_id: str) -> Optional[Invoice]:
        row = self._conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
        return self._to_model(row) if row else None

    def mark_status(self, invoice_id: str, status: str) -> None:
        self._conn.execute("UPDATE invoices SET status = ? WHERE id = ?", (status, invoice_id))
        self._conn.commit()

    def list_for_subscription(self, sub_id: str) -> list[Invoice]:
        rows = self._conn.execute(
            "SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at", (sub_id,)
        ).fetchall()
        return [self._to_model(r) for r in rows]

    def count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]

    @staticmethod
    def _to_model(row: sqlite3.Row) -> Invoice:
        return Invoice(
            id=row["id"], subscription_id=row["subscription_id"], amount=row["amount"],
            currency=row["currency"], status=row["status"], provider_reference=row["provider_reference"],
            created_at=row["created_at"],
        )


class WebhookEventRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def has_processed(self, event_id: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM webhook_events WHERE event_id = ?", (event_id,)).fetchone()
        return row is not None

    def record(
        self, event_id: str, event_type: str, subscription_id: Optional[str], payload: dict, received_at: str
    ) -> None:
        self._conn.execute(
            "INSERT INTO webhook_events (event_id, type, subscription_id, payload, received_at) VALUES (?, ?, ?, ?, ?)",
            (event_id, event_type, subscription_id, json.dumps(payload), received_at),
        )
        self._conn.commit()

    def count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM webhook_events").fetchone()[0]


class AuditLogRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def record(
        self, sub_id: str, event_type: str, from_status: Optional[str], to_status: Optional[str], created_at: str
    ) -> None:
        self._conn.execute(
            """INSERT INTO subscription_events (subscription_id, event_type, from_status, to_status, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (sub_id, event_type, from_status, to_status, created_at),
        )
        self._conn.commit()

    def list_for(self, sub_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY id", (sub_id,)
        ).fetchall()
        return [dict(r) for r in rows]
