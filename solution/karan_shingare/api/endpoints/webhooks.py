from werkzeug.test import TestResponse

from api.client import HttpClient


class WebhooksEndpoint:
    """Page-Object-Model equivalent for the /webhooks resource."""

    def __init__(self, http_client: HttpClient) -> None:
        self._http = http_client

    def send(self, raw_body: bytes, headers: dict) -> TestResponse:
        return self._http.post("/webhooks/payment-provider", data=raw_body, headers=headers)
