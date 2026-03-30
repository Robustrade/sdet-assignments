"""Shared fixtures: a fresh in-memory service and seeded wallets per test."""

import pytest

from service.app import create_app

_SEED_WALLETS = [
    ("wallet_001", 10000, "AED"),
    ("wallet_002", 5000, "AED"),
    ("wallet_003", 0, "AED"),
]


@pytest.fixture
def app():
    application = create_app(":memory:")
    for wallet_id, balance, currency in _SEED_WALLETS:
        application.db.execute(
            "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)",
            (wallet_id, balance, currency),
        )
    application.db.commit()
    yield application


@pytest.fixture
def client(app):
    return app.test_client()
