"""Happy path: successful transfers with multi-layer validation."""


def test_transfer_returns_201(client):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 2500,
            "currency": "AED",
            "reference": "invoice_123",
        },
        headers={"Idempotency-Key": "hp-001"},
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "completed"
    assert body["amount"] == 2500


def test_source_balance_decremented(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 1000,
            "currency": "AED",
        },
    )
    row = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()
    assert row["balance"] == 9000


def test_destination_balance_incremented(client, app):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 1000,
            "currency": "AED",
        },
    )
    row = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_002",)
    ).fetchone()
    assert row["balance"] == 6000


def test_net_balance_movement_equals_amount(client, app):
    before_src = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    before_dst = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_002",)
    ).fetchone()["balance"]

    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 3000,
            "currency": "AED",
        },
    )

    after_src = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    after_dst = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_002",)
    ).fetchone()["balance"]

    assert before_src - after_src == 3000
    assert after_dst - before_dst == 3000


def test_transfer_record_persisted(client, app):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 500,
            "currency": "AED",
        },
    )
    transfer_id = resp.get_json()["id"]
    row = app.db.execute(
        "SELECT * FROM transfers WHERE id = ?", (transfer_id,)
    ).fetchone()
    assert row is not None
    assert row["status"] == "completed"
    assert row["amount"] == 500


def test_audit_event_created(client, app):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 500,
            "currency": "AED",
        },
    )
    transfer_id = resp.get_json()["id"]
    event = app.db.execute(
        "SELECT * FROM audit_events WHERE transfer_id = ?", (transfer_id,)
    ).fetchone()
    assert event is not None
    assert event["event_type"] == "transfer_completed"


def test_get_transfer_returns_correct_state(client):
    post_resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 300,
            "currency": "AED",
        },
    )
    transfer_id = post_resp.get_json()["id"]
    get_resp = client.get(f"/transfers/{transfer_id}")
    assert get_resp.status_code == 200
    assert get_resp.get_json()["status"] == "completed"


def test_get_wallet_reflects_updated_balance(client):
    client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 2000,
            "currency": "AED",
        },
    )
    resp = client.get("/wallets/wallet_001")
    assert resp.status_code == 200
    assert resp.get_json()["balance"] == 8000


def test_api_and_db_transfer_state_consistent(client, app):
    resp = client.post(
        "/transfers",
        json={
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 750,
            "currency": "AED",
        },
    )
    api_body = resp.get_json()
    db_row = app.db.execute(
        "SELECT * FROM transfers WHERE id = ?", (api_body["id"],)
    ).fetchone()
    assert db_row["status"] == api_body["status"]
    assert db_row["amount"] == api_body["amount"]
