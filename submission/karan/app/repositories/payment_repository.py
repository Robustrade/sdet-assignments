from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import Payment


class PaymentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, payment: Payment) -> None:
        self.session.add(payment)

    def for_invoice(self, invoice_id: str) -> list[Payment]:
        return list(self.session.scalars(select(Payment).where(Payment.invoice_id == invoice_id)))
