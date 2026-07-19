"""
API Client / Test Interface Layer.

Wraps the raw TestClient so scenario tests read like business statements
("post_transfer(...)") instead of repeating headers/URLs everywhere.
Swapping this for a real HTTP client against a deployed service would not
require touching any test scenario file -- only this module.
"""


class WalletTransferApiClient:
    def __init__(self, http_client):
        self._http = http_client

    def post_transfer(self, payload: dict, idempotency_key: str, headers: dict = None):
        h = {"Idempotency-Key": idempotency_key}
        if headers:
            h.update(headers)
        return self._http.post("/transfers", json=payload, headers=h)

    def post_transfer_raw(self, json_body, idempotency_key: str = None):
        """For malformed-request tests where we don't want builder validation."""
        h = {}
        if idempotency_key is not None:
            h["Idempotency-Key"] = idempotency_key
        return self._http.post("/transfers", json=json_body, headers=h)

    def get_transfer(self, transfer_id: str):
        return self._http.get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id: str):
        return self._http.get(f"/wallets/{wallet_id}")
