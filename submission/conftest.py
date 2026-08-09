import os
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("WALLET_TEST_DB", "wallet_transfer_test.db")

from app.db import reset_db, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from tests.data_builders import make_wallet  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    """
    Every test gets a fully reset schema. This is what stops one test's
    leftover rows from producing a false positive/negative in another --
    the assignment explicitly calls out avoiding stale-data false positives.
    """
    reset_db()
    yield


@pytest.fixture
def db_session():
    """
    Direct DB session for test-side setup/verification. Held for the
    duration of the test (not per-call) since our concurrency tests spawn
    threads that hit the API independently; those threads acquire the same
    lock via the API's own get_db dependency, so this fixture must release
    it before threads run, not hold it across the whole test.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def seeded_wallets(db_session):
    """Two wallets with a known starting balance, in the same currency."""
    source = make_wallet(db_session, balance=10_000, currency="AED")
    destination = make_wallet(db_session, balance=5_000, currency="AED")
    db_session.commit()
    return source, destination


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
