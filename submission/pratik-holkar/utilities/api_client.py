"""Single HTTP client for the wallet service.

Two backends behind one interface so the same tests run in-process
(Flask test client) and against a real env (HTTP via requests).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

import requests
from flask.testing import FlaskClient


@dataclass
class ApiResponse:
    status_code: int
    json_body: Any
    headers: Mapping[str, str]

    def json(self):
        return self.json_body


class WalletApiClient:
    def __init__(
        self,
        *,
        base_url: str = "",
        flask_client: Optional[FlaskClient] = None,
        api_user: str = "",
        api_token: str = "",
        timeout: int = 10,
    ):
        if not flask_client and not base_url:
            raise ValueError("Provide either flask_client or base_url.")
        self._flask = flask_client
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._auth: dict[str, str] = {}
        if api_token:
            self._auth["Authorization"] = f"Bearer {api_token}"
        elif api_user:
            self._auth["X-Api-User"] = api_user

    def create_transfer(self, payload, idempotency_key=None) -> ApiResponse:
        headers = dict(self._auth)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return self._post("/transfers", json=payload, headers=headers)

    def get_transfer(self, transfer_id) -> ApiResponse:
        return self._get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id) -> ApiResponse:
        return self._get(f"/wallets/{wallet_id}")

    # ------------------------------------------------------------------

    def _post(self, path, *, json, headers) -> ApiResponse:
        if self._flask is not None:
            r = self._flask.post(path, json=json, headers=headers)
            return ApiResponse(r.status_code, r.get_json(silent=True), dict(r.headers))
        r = requests.post(
            f"{self._base_url}{path}",
            json=json,
            headers={**self._auth, **headers},
            timeout=self._timeout,
        )
        return ApiResponse(r.status_code, _safe_json(r), dict(r.headers))

    def _get(self, path) -> ApiResponse:
        if self._flask is not None:
            r = self._flask.get(path, headers=self._auth)
            return ApiResponse(r.status_code, r.get_json(silent=True), dict(r.headers))
        r = requests.get(
            f"{self._base_url}{path}",
            headers=self._auth,
            timeout=self._timeout,
        )
        return ApiResponse(r.status_code, _safe_json(r), dict(r.headers))


def _safe_json(resp: requests.Response):
    try:
        return resp.json()
    except ValueError:
        return None
