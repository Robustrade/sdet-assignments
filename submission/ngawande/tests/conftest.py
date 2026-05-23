"""Setup file — creates a fresh app and database before each test.

pytest automatically finds this file and uses the fixtures defined here.
No need to import it anywhere — just use 'app' or 'client' as test parameters.
"""

import pytest

from service.app import create_app

_SEED_WALLETS = [
    ("wallet_001", 10_000, "AED"),
    ("wallet_002", 5_000, "AED"),
    ("wallet_003", 0, "AED"),
    ("wallet_004", 10_000, "USD"),
]


@pytest.fixture()
def app():
    """Create a fresh app with seeded wallets for each test."""
    application = create_app(":memory:")
    for wallet_id, balance, currency in _SEED_WALLETS:
        application.db.execute(
            "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)",
            (wallet_id, balance, currency),
        )
    application.db.commit()
    yield application


@pytest.fixture()
def client(app):
    """Flask test client bound to the per-test app."""
    return app.test_client()

