from werkzeug.test import TestResponse

from api.client import HttpClient


class SubscriptionsEndpoint:
    """Page-Object-Model equivalent for the /subscriptions resource.

    Readable, reusable actions for every test ("create a subscription") -
    never raw HTTP verbs/paths in a test body.
    """

    def __init__(self, http_client: HttpClient) -> None:
        self._http = http_client

    def create(self, payload: dict) -> TestResponse:
        return self._http.post("/subscriptions", json=payload)

    def get(self, subscription_id: str) -> TestResponse:
        return self._http.get(f"/subscriptions/{subscription_id}")

    def cancel(self, subscription_id: str) -> TestResponse:
        return self._http.post(f"/subscriptions/{subscription_id}/cancel")

    def charge(self, subscription_id: str) -> TestResponse:
        return self._http.post(f"/subscriptions/{subscription_id}/charge")

    def retry_charge(self, subscription_id: str) -> TestResponse:
        return self._http.post(f"/subscriptions/{subscription_id}/retry-charge")
