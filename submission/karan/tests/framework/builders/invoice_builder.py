from __future__ import annotations

from app.database import Repositories
from app.domain.models import Invoice


def open_renewal_invoice(
    repositories: Repositories,
    subscription_id: str,
    *,
    amount: int = 4900,
    currency: str = "USD",
    attempt_number: int = 2,
) -> Invoice:
    invoice = Invoice(
        subscription_id=subscription_id,
        amount=amount,
        currency=currency,
        status="open",
        attempt_number=attempt_number,
    )
    repositories.invoices.add(invoice)
    repositories.session.commit()
    return invoice
