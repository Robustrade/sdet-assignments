from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI


class BillingApiClient:
    def __init__(self, app: FastAPI) -> None:
        self.app = app

    def _request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        async def send() -> httpx.Response:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as client:
                return await client.request(method, url, **kwargs)
        return asyncio.run(send())

    def create_subscription(self, payload: dict[str, str]) -> httpx.Response:
        return self._request("POST", "/subscriptions", json=payload)

    def get_subscription(self, subscription_id: str) -> httpx.Response:
        return self._request("GET", f"/subscriptions/{subscription_id}")

    def cancel_subscription(self, subscription_id: str) -> httpx.Response:
        return self._request("POST", f"/subscriptions/{subscription_id}/cancel")

    def deliver_webhook(self, raw: bytes, signature: str) -> httpx.Response:
        return self._request("POST", "/webhooks/payment-provider", content=raw,
                             headers={"X-Provider-Signature": signature, "Content-Type": "application/json"})
