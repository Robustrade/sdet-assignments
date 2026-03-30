"""Validation failures: bad input must be rejected with no DB side-effects."""


def test_missing_source_wallet(client):
    resp = client.post(
        "/transfers",
        json={"destination_wallet_id": "wallet_002", "amount": 100, "currency": "AED"},
    )
    assert resp.status_code == 422


def test_missing_destination_wallet(client):
    resp = client.post(
        "/transfers",
        json={"source_wallet_id": "wallet_001", "amount": 100, "currency": "AED"},
    )
    assert resp.status_code == 422


def test_missing_amount(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_missing_currency(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 100,
        },
    )
    assert resp.status_code == 422


def test_invalid_currency(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 100,
            "currency": "XYZ",
        },
    )
    assert resp.status_code == 422


def test_negative_amount(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": -100,
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_zero_amount(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 0,
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_same_source_and_destination(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_001",
            "amount": 100,
            "currency": "AED",
        },
    )
    assert resp.status_code == 422


def test_invalid_input_leaves_no_transfer_record(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": -999,
            "currency": "AED",
        },
    )
    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 0


def test_invalid_input_leaves_balances_unchanged(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 0,
            "currency": "AED",
        },
    )
    src = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    dst = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_002",)
    ).fetchone()["balance"]
    assert src == 10000
    assert dst == 5000
