import json
import sqlite3

from flask import Flask, request, jsonify
from flask.typing import ResponseReturnValue

from service.billing_service import BillingService
from service.errors import ValidationError, NotFoundError, InvalidTransitionError
from service.payment_provider import PaymentProvider
from service.signature import verify

DEFAULT_WEBHOOK_SECRET: str = "whsec_test_secret"


def create_app(
    conn: sqlite3.Connection, provider: PaymentProvider, webhook_secret: str = DEFAULT_WEBHOOK_SECRET
) -> Flask:
    app = Flask(__name__)
    billing = BillingService(conn, provider)

    @app.post("/subscriptions")
    def create_subscription() -> ResponseReturnValue:
        data = request.get_json(silent=True) or {}
        try:
            sub = billing.create_subscription(**data)
        except ValidationError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(sub.to_dict()), 201

    @app.get("/subscriptions/<sub_id>")
    def get_subscription(sub_id: str) -> ResponseReturnValue:
        try:
            sub = billing.get_subscription(sub_id)
        except NotFoundError as exc:
            return jsonify(error=str(exc)), 404
        return jsonify(sub.to_dict())

    @app.post("/subscriptions/<sub_id>/cancel")
    def cancel_subscription(sub_id: str) -> ResponseReturnValue:
        try:
            sub = billing.cancel_subscription(sub_id)
        except NotFoundError as exc:
            return jsonify(error=str(exc)), 404
        except InvalidTransitionError as exc:
            return jsonify(error=str(exc)), 409
        return jsonify(sub.to_dict())

    @app.post("/subscriptions/<sub_id>/charge")
    def charge_subscription(sub_id: str) -> ResponseReturnValue:
        try:
            sub = billing.charge_now(sub_id)
        except NotFoundError as exc:
            return jsonify(error=str(exc)), 404
        except InvalidTransitionError as exc:
            return jsonify(error=str(exc)), 409
        return jsonify(sub.to_dict())

    @app.post("/subscriptions/<sub_id>/retry-charge")
    def retry_charge_subscription(sub_id: str) -> ResponseReturnValue:
        try:
            sub = billing.retry_charge(sub_id)
        except NotFoundError as exc:
            return jsonify(error=str(exc)), 404
        except InvalidTransitionError as exc:
            return jsonify(error=str(exc)), 409
        return jsonify(sub.to_dict())

    @app.post("/webhooks/payment-provider")
    def payment_webhook() -> ResponseReturnValue:
        raw_body = request.get_data()
        signature = request.headers.get("X-Provider-Signature")
        if not verify(raw_body, signature, webhook_secret):
            return jsonify(error="invalid signature"), 401
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            return jsonify(error="malformed payload"), 400
        try:
            result = billing.handle_webhook(payload)
        except ValidationError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(result), 200

    return app
