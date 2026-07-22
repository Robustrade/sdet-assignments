"""Shared fixtures: isolated in-memory service and seeded wallets per test."""

from __future__ import annotations

import pytest

from service.app import create_app
from tests.helpers.api_client import TransferApiClient

SEED_WALLETS = [
    ("wallet_001", 10000, "AED"),
    ("wallet_002", 5000, "AED"),
    ("wallet_003", 0, "AED"),
]


@pytest.fixture
def app():
    application = create_app(":memory:")
    for wallet_id, balance, currency in SEED_WALLETS:
        application.db.execute(
            "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)",
            (wallet_id, balance, currency),
        )
    application.db.commit()
    yield application
    application.db.close()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def api(client):
    return TransferApiClient(client)


@pytest.fixture
def db(app):
    return app.db
