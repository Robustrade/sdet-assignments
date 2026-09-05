from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import Invoice


class InvoiceRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, invoice: Invoice) -> None:
        self.session.add(invoice)

    def get(self, invoice_id: str) -> Invoice | None:
        return self.session.get(Invoice, invoice_id)

    def for_subscription(self, subscription_id: str) -> list[Invoice]:
        return list(self.session.scalars(select(Invoice).where(Invoice.subscription_id == subscription_id)))
