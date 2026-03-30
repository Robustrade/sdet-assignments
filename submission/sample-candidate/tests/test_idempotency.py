"""Idempotency: duplicate submissions must be handled correctly."""


def test_same_key_same_payload_returns_original(client):
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "idem-001"}

    resp1 = client.post("/transfers", json=payload, headers=headers)
    resp2 = client.post("/transfers", json=payload, headers=headers)

    assert resp1.status_code == 201
    assert resp2.status_code == 200
    assert resp1.get_json()["id"] == resp2.get_json()["id"]


def test_same_key_same_payload_no_double_debit(client, app):
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "idem-002"}

    client.post("/transfers", json=payload, headers=headers)
    client.post("/transfers", json=payload, headers=headers)

    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 9000  # debited exactly once


def test_same_key_same_payload_single_transfer_row(client, app):
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "idem-003"}

    client.post("/transfers", json=payload, headers=headers)
    client.post("/transfers", json=payload, headers=headers)

    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 1


def test_same_key_same_payload_single_audit_event(client, app):
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "idem-audit"}

    client.post("/transfers", json=payload, headers=headers)
    client.post("/transfers", json=payload, headers=headers)

    count = app.db.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
    assert count == 1


def test_same_key_different_payload_rejected(client):
    headers = {"Idempotency-Key": "idem-004"}

    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 1000,
            "currency": "AED",
        },
        headers=headers,
    )

    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 2000,
            "currency": "AED",
        },
        headers=headers,
    )
    assert resp.status_code == 409


def test_same_key_different_payload_no_second_transfer(client, app):
    headers = {"Idempotency-Key": "idem-005"}

    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 1000,
            "currency": "AED",
        },
        headers=headers,
    )
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 2000,
            "currency": "AED",
        },
        headers=headers,
    )

    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 1
    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 9000  # only the first 1000 was debited


def test_no_idempotency_key_creates_independent_transfers(client, app):
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 100,
        "currency": "AED",
    }

    resp1 = client.post("/transfers", json=payload)
    resp2 = client.post("/transfers", json=payload)

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.get_json()["id"] != resp2.get_json()["id"]
    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 2
