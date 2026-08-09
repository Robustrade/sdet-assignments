"""
Category E -- Concurrency and Race Conditions (mandatory).

Uses real threads hitting the same FastAPI app/DB concurrently (via
TestClient, which is thread-safe for this purpose) to prove the service
does not allow two competing requests to over-spend a wallet, and that
concurrent duplicate submissions collapse to a single side effect.

Note on scope: this exercises the fixture's in-process lock strategy, which
is documented in docs/TEST_STRATEGY.md as a simplification for a
single-process SQLite fixture. Against a real multi-instance service the
same test *shape* would apply, but the correctness guarantee would need to
come from the database (row locks / unique constraints), not an in-process
mutex -- which is exactly the kind of thing this suite is designed to catch
if it regressed.
"""
import threading

from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import get_wallet_balance, count_transfers_for_idempotency_key, count_all_transfers


def _run_concurrently(fns):
    threads = [threading.Thread(target=fn) for fn in fns]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


def test_two_concurrent_transfers_cannot_both_succeed_when_balance_only_covers_one(client, db_session, seeded_wallets):
    """
    Source wallet has 10_000. Fire two concurrent transfers of 7_000 each
    (different idempotency keys, i.e. genuinely distinct requests). At most
    one may succeed -- if both succeeded the wallet would go negative.
    """
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    results = {}

    def attempt(label, key):
        resp = api.post_transfer(transfer_payload(source, destination, amount=7000), key)
        results[label] = resp

    _run_concurrently([
        lambda: attempt("a", new_idempotency_key()),
        lambda: attempt("b", new_idempotency_key()),
    ])

    statuses = sorted(r.status_code for r in results.values())
    assert statuses == [201, 422], f"expected exactly one success and one rejection, got {statuses}"

    final_balance = get_wallet_balance(db_session, source.id)
    assert final_balance == 10_000 - 7_000, "source balance must never go negative under concurrent competing transfers"


def test_concurrent_requests_with_same_idempotency_key_produce_single_transfer(client, db_session, seeded_wallets):
    """
    Two threads race to be the first to use the same idempotency key with the
    same payload. Exactly one Transfer row (and one balance movement) should
    result, regardless of which thread 'wins'.
    """
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=2000)
    responses = []
    lock = threading.Lock()

    def attempt():
        resp = api.post_transfer(payload, key)
        with lock:
            responses.append(resp)

    _run_concurrently([attempt, attempt, attempt, attempt])

    assert all(r.status_code == 201 for r in responses)
    transfer_ids = {r.json()["transfer_id"] for r in responses}
    assert len(transfer_ids) == 1, "all racing replays must resolve to the same transfer_id"
    assert count_transfers_for_idempotency_key(db_session, key) == 1
    assert get_wallet_balance(db_session, source.id) == 10_000 - 2000


def test_concurrent_transfers_on_unrelated_wallets_both_succeed(client, db_session):
    """
    Sanity check on the flip side: concurrency control should serialize
    *contending* transfers, not the whole service. Two transfers touching
    four distinct wallets should both complete.
    """
    from tests.data_builders import make_wallet
    api = WalletTransferApiClient(client)
    w1 = make_wallet(db_session, balance=5000)
    w2 = make_wallet(db_session, balance=5000)
    w3 = make_wallet(db_session, balance=5000)
    w4 = make_wallet(db_session, balance=5000)
    db_session.commit()

    results = {}

    def attempt(label, src, dst):
        resp = api.post_transfer(transfer_payload(src, dst, amount=1000), new_idempotency_key())
        results[label] = resp

    _run_concurrently([
        lambda: attempt("a", w1, w2),
        lambda: attempt("b", w3, w4),
    ])

    assert results["a"].status_code == 201
    assert results["b"].status_code == 201


def test_read_after_concurrent_write_reflects_committed_state(client, db_session, seeded_wallets):
    """
    After a burst of concurrent competing requests settles, a GET must
    reflect the same state that the DB verification layer sees -- no stale
    or partially-applied reads.
    """
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets

    def attempt(key):
        api.post_transfer(transfer_payload(source, destination, amount=3000), key)

    keys = [new_idempotency_key() for _ in range(3)]
    _run_concurrently([lambda k=k: attempt(k) for k in keys])

    api_balance = api.get_wallet(source.id).json()["balance"]
    db_balance = get_wallet_balance(db_session, source.id)
    assert api_balance == db_balance
