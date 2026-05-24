"""Thin wrapper around the Flask test client.

Keeps transport noise (paths, headers, query-string juggling) out of test
bodies. Tests read as business behavior:

    client.create_transfer(payload, idempotency_key=key)
    client.get_wallet("wallet_001")

Returns the raw Flask response so tests can still assert status codes and
inspect headers / body directly.
"""

from __future__ import annotations

from typing import Any

from flask.testing import FlaskClient


class TransferClient:
    def __init__(self, http: FlaskClient) -> None:
        self._http = http

    def create_transfer(
        self,
        payload: dict[str, Any],
        idempotency_key: str | None = None,
        force_fail: bool = False,
    ):
        headers: dict[str, str] = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        path = "/transfers"
        if force_fail:
            path = "/transfers?force_fail=true"
        return self._http.post(path, json=payload, headers=headers)

    def get_transfer(self, transfer_id: str):
        return self._http.get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id: str):
        return self._http.get(f"/wallets/{wallet_id}")
