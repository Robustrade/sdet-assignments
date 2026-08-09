"""Shared fixtures.

Every test gets a fresh in-memory app + DB, seeded with known wallets. There is
no state leakage between tests because the app is rebuilt per test.

Seed wallets (always present at the start of a test):
    wallet_001  AED  10_000  (the funded source for most happy-path tests)
    wallet_002  AED   5_000  (the typical destination)
    wallet_003  AED       0  (zero-balance, used for insufficient-balance tests)
    wallet_usd  USD   1_000  (used for currency-mismatch tests)
"""

from __future__ import annotations

from typing import Any

import pytest
from flask import Flask

from service.app import create_app
from tests.support.api_client import TransferClient
from tests.support.db_verifier import DbVerifier

SEED_WALLETS: list[tuple[str, int, str]] = [
    ("wallet_001", 10_000, "AED"),
    ("wallet_002", 5_000, "AED"),
    ("wallet_003", 0, "AED"),
    ("wallet_usd", 1_000, "USD"),
]


@pytest.fixture
def app() -> Flask:
    application = create_app(":memory:")
    for wallet_id, balance, currency in SEED_WALLETS:
        application.db.execute(  # type: ignore[attr-defined]
            "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)",
            (wallet_id, balance, currency),
        )
    application.db.commit()  # type: ignore[attr-defined]
    return application


@pytest.fixture
def http(app: Flask):
    return app.test_client()


@pytest.fixture
def client(http) -> TransferClient:
    return TransferClient(http)


@pytest.fixture
def db(app: Flask) -> DbVerifier:
    return DbVerifier(app.db)  # type: ignore[attr-defined]


@pytest.fixture
def publisher(app: Flask):
    return app.publisher  # type: ignore[attr-defined]


@pytest.fixture
def notifier(app: Flask):
    return app.notifier  # type: ignore[attr-defined]


@pytest.fixture
def seed_balances() -> dict[str, int]:
    """Convenient dict of the original seed amounts for diff-based assertions."""
    return {wallet_id: balance for wallet_id, balance, _ in SEED_WALLETS}


@pytest.fixture
def valid_payload() -> dict[str, Any]:
    """Default valid POST /transfers body. Tests mutate freely; fixture is per-test."""
    return {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
        "reference": "invoice_default",
    }
