"""Insufficient balance: transfers must be rejected without mutating any state."""


def test_insufficient_balance_returns_422(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 99999,
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_insufficient_balance_source_unchanged(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 99999,
            "currency": "AED",
        },
    )
    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 10000


def test_insufficient_balance_destination_unchanged(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 99999,
            "currency": "AED",
        },
    )
    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_002",)
    ).fetchone()["balance"]
    assert balance == 5000


def test_insufficient_balance_no_transfer_record(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 99999,
            "currency": "AED",
        },
    )
    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 0


def test_insufficient_balance_no_audit_event(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 99999,
            "currency": "AED",
        },
    )
    count = app.db.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
    assert count == 0


def test_zero_balance_wallet_rejected(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_003",
            "destination_wallet_id": "wallet_001",
            "amount": 1,
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_exact_balance_transfer_succeeds(client, app):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 10000,
            "currency": "AED",
        },
    )
    assert resp.status_code == 201
    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 0
