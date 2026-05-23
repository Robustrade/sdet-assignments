"""Per-test fixtures: settings, fresh app+DB, API client, DB client.

Each test gets its own in-memory SQLite, so xdist parallelism is safe.
The wallet seed is small and intentional - just enough to cover the
edge cases the YAML scenarios reference (positive balance, zero balance,
different currency for the mismatch tests).
"""

import pytest

from config.settings import Settings
from service.app import create_app
from utilities.api_client import WalletApiClient
from utilities.db_client import WalletDbClient

# (wallet_id, owner_id, currency, balance_minor)
SEED = [
    ("acc_alpha", "owner_1", "USD", 50_000_00),
    ("acc_beta", "owner_2", "USD", 25_000_00),
    ("acc_gamma", "owner_3", "USD", 0),
    ("acc_delta", "owner_4", "EUR", 10_000_00),
]


@pytest.fixture(scope="session")
def settings():
    return Settings.load()


@pytest.fixture
def app(settings):
    if not settings.use_inprocess_service:
        pytest.skip("In-process app not available against a remote env.")
    a = create_app()  # default = unique shared in-memory DB
    db = WalletDbClient(a.db)
    for wid, owner, ccy, bal in SEED:
        db.seed_wallet(wid, owner, ccy, bal)
    yield a


@pytest.fixture
def api(app, settings):
    if settings.use_inprocess_service:
        return WalletApiClient(flask_client=app.test_client())
    return WalletApiClient(
        base_url=settings.base_url,
        api_user=settings.api_user,
        api_token=settings.api_token,
        timeout=settings.request_timeout_seconds,
    )


@pytest.fixture
def db(app):
    return WalletDbClient(app.db)
