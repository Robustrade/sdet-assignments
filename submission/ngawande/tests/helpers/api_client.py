"""Helper to make API calls without repeating HTTP code in every test."""

from __future__ import annotations

from flask.testing import FlaskClient


class TransferAPIClient:
    """Simple wrapper so tests can call API methods with clean syntax."""

    def __init__(self, client: FlaskClient) -> None:
        self._client = client

    def create_transfer(
        self,
        source: str = "wallet_001",
        destination: str = "wallet_002",
        amount: int = 1_000,
        currency: str = "AED",
        reference: str | None = None,
        idempotency_key: str | None = None,
    ):
        """Send a POST /transfers request. Returns the response."""
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
        """Send a POST /transfers with custom payload (for testing bad input)."""
        headers = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return self._client.post("/transfers", json=payload, headers=headers)

    # -- Read endpoints ----------------------------------------------------

    def get_transfer(self, transfer_id: str):
        """GET /transfers/{id} — check a transfer's details."""
        return self._client.get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id: str):
        """GET /wallets/{id} — check a wallet's balance."""
        return self._client.get(f"/wallets/{wallet_id}")

