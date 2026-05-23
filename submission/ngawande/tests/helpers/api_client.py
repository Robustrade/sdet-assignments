"""API client wrapper — keeps transport details out of test logic."""

from __future__ import annotations

from flask.testing import FlaskClient


class TransferAPIClient:
    """Thin wrapper around FlaskClient for wallet-transfer endpoints."""

    def __init__(self, client: FlaskClient) -> None:
        self._client = client

    # -- Transfers ---------------------------------------------------------

    def create_transfer(
        self,
        source: str = "wallet_001",
        destination: str = "wallet_002",
        amount: int = 1_000,
        currency: str = "AED",
        reference: str | None = None,
        idempotency_key: str | None = None,
    ):
        """POST /transfers and return the raw Flask test response."""
        payload: dict = {
            "source_wallet_id": source,
            "destination_wallet_id": destination,
            "amount": amount,
            "currency": currency,
        }
        if reference is not None:
            payload["reference"] = reference

        headers = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key

        return self._client.post("/transfers", json=payload, headers=headers)

    def create_transfer_raw(self, payload: dict, idempotency_key: str | None = None):
        """POST /transfers with an arbitrary payload dict (for validation tests)."""
        headers = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return self._client.post("/transfers", json=payload, headers=headers)

    # -- Read endpoints ----------------------------------------------------

    def get_transfer(self, transfer_id: str):
        """GET /transfers/{transfer_id}."""
        return self._client.get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id: str):
        """GET /wallets/{wallet_id}."""
        return self._client.get(f"/wallets/{wallet_id}")

