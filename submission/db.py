import os
import threading

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base

DB_PATH = os.environ.get("WALLET_TEST_DB", "wallet_transfer_test.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

# NOTE (documented simplification, see docs/TEST_STRATEGY.md "Concurrency
# strategy"): the sqlite3 C-level connection object is not safe for genuinely
# concurrent use from multiple threads even with check_same_thread=False --
# that flag only disables Python's same-thread *assertion*, it does not make
# the connection thread-safe. StaticPool gives every session the same single
# connection, and db_write_lock below serializes actual access to it. This
# is a fixture-only concern: a real Postgres/MySQL-backed service would rely
# on the database's own connection pooling and row/transaction locking
# instead of an in-process mutex.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)

# Serializes all access to the single shared SQLite connection across
# threads. Distinct from the per-wallet-pair business lock in app/main.py,
# which expresses *domain* concurrency control (competing transfers); this
# lock exists purely because SQLite itself cannot be trusted with concurrent
# access from multiple threads.
db_write_lock = threading.Lock()


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    # Enforce FK constraints and serialize writers so our "row lock via
    # BEGIN IMMEDIATE" concurrency strategy behaves predictably under SQLite.
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
    # expire_on_commit=False matters here specifically for test-side fixture
    # objects (e.g. wallets returned by seeded_wallets/make_wallet): without
    # it, attribute access on a committed ORM object triggers a fresh SELECT
    # on first touch, which is unsafe to do from a background thread outside
    # db_write_lock. With it, simple attributes like `.id` are served from
    # the object's own memory after commit, as they should be for immutable
    # identifiers.
    expire_on_commit=False,
)


def init_db():
    Base.metadata.create_all(engine)


def reset_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
