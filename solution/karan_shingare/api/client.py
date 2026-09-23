from typing import Optional

from flask.testing import FlaskClient
from werkzeug.test import TestResponse


class HttpClient:
    """Thin wrapper around Flask's test client.

    The one place that knows about HTTP verbs and paths - endpoint objects
    talk to this, never to Flask directly. Mirrors the UI layer's
    WebInspector/Page split (see ui_bonus/ui/web_inspector.py).
    """

    def __init__(self, test_client: FlaskClient) -> None:
        self._test_client = test_client

    def get(self, path: str) -> TestResponse:
        return self._test_client.get(path)

    def post(
        self, path: str, json: Optional[dict] = None, data: Optional[bytes] = None,
        headers: Optional[dict] = None,
    ) -> TestResponse:
        return self._test_client.post(path, json=json, data=data, headers=headers)
