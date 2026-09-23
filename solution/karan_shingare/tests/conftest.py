import sqlite3
from typing import Iterator
from types import SimpleNamespace

import pytest
from flask import Flask

from api.client import HttpClient
from api.endpoints.subscriptions import SubscriptionsEndpoint
from api.endpoints.webhooks import WebhooksEndpoint
from api.runner import ApiRunner
from service.app import create_app
from service.repository import (
    init_schema, CustomerRepository, SubscriptionRepository,
    InvoiceRepository, WebhookEventRepository, AuditLogRepository,
)
from utils.builders import CustomerBuilder
from utils.fake_payment_provider import FakePaymentProvider

WEBHOOK_SECRET: str = "whsec_test_secret"


@pytest.fixture
def webhook_secret() -> str:
    return WEBHOOK_SECRET


@pytest.fixture
def db_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_schema(conn)
    yield conn
    conn.close()


@pytest.fixture
def repos(db_conn: sqlite3.Connection) -> SimpleNamespace:
    # Bundled for tests that need to assert against several tables; every
    # repository here is the same one the service itself uses under the hood.
    return SimpleNamespace(
        customers=CustomerRepository(db_conn),
        subscriptions=SubscriptionRepository(db_conn),
        invoices=InvoiceRepository(db_conn),
        webhook_events=WebhookEventRepository(db_conn),
        audit=AuditLogRepository(db_conn),
    )


@pytest.fixture
def provider() -> FakePaymentProvider:
    return FakePaymentProvider()


@pytest.fixture
def flask_app(db_conn: sqlite3.Connection, provider: FakePaymentProvider) -> Flask:
    return create_app(db_conn, provider, webhook_secret=WEBHOOK_SECRET)


@pytest.fixture
def http_client(flask_app: Flask) -> HttpClient:
    return HttpClient(flask_app.test_client())


@pytest.fixture
def api(http_client: HttpClient) -> SimpleNamespace:
    """The API's Page-Object-Model layer: one endpoint object per resource,
    reusable across every test - tests never see HTTP verbs/paths directly.
    Mirrors ui_bonus's WebInspector + page-object split for the UI."""
    return SimpleNamespace(
        subscriptions=SubscriptionsEndpoint(http_client),
        webhooks=WebhooksEndpoint(http_client),
    )


@pytest.fixture
def runner(api: SimpleNamespace) -> ApiRunner:
    """Data-driven request runner: turns a data/*.py case into a request
    against `api` and validates the response against that same case."""
    return ApiRunner(api)


@pytest.fixture
def customer(repos: SimpleNamespace) -> dict:
    data = CustomerBuilder().build()
    repos.customers.create(data["id"], data["name"])
    return data
