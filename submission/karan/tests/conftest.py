import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import create_app
from app.database import Repositories, create_schema
from app.providers.mock_payment_provider import MockPaymentProvider
from app.services.subscription_service import SubscriptionService
from tests.framework.assertions.billing_assertions import BillingAssertions
from tests.framework.builders.customer_builder import CustomerBuilder
from tests.framework.clients.subscription_api_client import BillingApiClient


@pytest.fixture
def repositories() -> Repositories:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    create_schema(engine)
    session = Session(engine)
    repositories = Repositories.from_session(session)
    repositories.subscriptions.add_customer(CustomerBuilder().build())
    session.commit()
    yield repositories
    session.close()


@pytest.fixture
def provider() -> MockPaymentProvider:
    return MockPaymentProvider()


@pytest.fixture
def service(repositories: Repositories, provider: MockPaymentProvider) -> SubscriptionService:
    return SubscriptionService(repositories, provider)


@pytest.fixture
def api(service: SubscriptionService) -> BillingApiClient:
    return BillingApiClient(create_app(service))


@pytest.fixture
def verify(repositories: Repositories) -> BillingAssertions:
    return BillingAssertions(repositories)
