from __future__ import annotations

import hashlib
import hmac
import json
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

from app.domain.states import TransitionError
from app.services.subscription_service import NotFoundError, SubscriptionService


WEBHOOK_SECRET = "test-webhook-secret"


class CreateSubscriptionRequest(BaseModel):
    customer_id: str
    plan: str
    payment_method_id: str


def create_app(service: SubscriptionService) -> FastAPI:
    app = FastAPI()

    def get_service() -> SubscriptionService:
        return service

    @app.post("/subscriptions", status_code=201)
    def create_subscription(body: CreateSubscriptionRequest, svc: SubscriptionService = Depends(get_service)):
        try:
            subscription = svc.create_subscription(body.customer_id, body.plan, body.payment_method_id)
        except (ValueError, NotFoundError) as exc:
            svc.repositories.session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"id": subscription.id, "customer_id": subscription.customer_id,
                "plan": subscription.plan, "status": subscription.status}

    @app.post("/subscriptions/{subscription_id}/cancel")
    def cancel_subscription(subscription_id: str, svc: SubscriptionService = Depends(get_service)):
        try:
            subscription = svc.cancel(subscription_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except TransitionError as exc:
            svc.repositories.session.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"id": subscription.id, "status": subscription.status}

    @app.get("/subscriptions/{subscription_id}")
    def get_subscription(subscription_id: str, svc: SubscriptionService = Depends(get_service)):
        subscription = svc.get_subscription(subscription_id)
        if not subscription:
            raise HTTPException(status_code=404, detail="Subscription not found")
        return {"id": subscription.id, "customer_id": subscription.customer_id,
                "plan": subscription.plan, "status": subscription.status}

    @app.post("/webhooks/payment-provider")
    async def payment_webhook(request: Request, x_provider_signature: str | None = Header(default=None),
                              svc: SubscriptionService = Depends(get_service)):
        raw_body = await request.body()
        expected = hmac.new(WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
        if not x_provider_signature or not hmac.compare_digest(expected, x_provider_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")
        try:
            processed = svc.process_webhook(json.loads(raw_body))
        except (KeyError, ValueError, NotFoundError) as exc:
            svc.repositories.session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"processed": processed}

    return app
