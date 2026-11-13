
import { AppDatabase } from '../database/database';
import { InvoiceRepository } from '../repositories/InvoiceRepository';
import { PaymentRepository } from '../repositories/PaymentRepository';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { PaymentProvider } from '../providers/PaymentProvider';
import { createPayment } from '../models/Payment';
import { canTransition, transitionSubscription } from '../state/SubscriptionStateMachine';

export class PaymentService {
  constructor(
    private db: AppDatabase,
    private invoiceRepository: InvoiceRepository,
    private paymentRepository: PaymentRepository,
    private subscriptionRepository: SubscriptionRepository,
    private paymentProvider: PaymentProvider
  ) {}

  async processPayment(
    invoiceId: string,
    paymentId: string
  ) {
    const invoice = this.invoiceRepository.findById(invoiceId);

    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    if (invoice.status !== 'open') {
      throw new Error(`Invoice is not payable: ${invoice.status}`);
    }

    const subscription = this.subscriptionRepository.findById(
      invoice.subscriptionId
    );

    if (!subscription) {
      throw new Error(
        `Subscription not found: ${invoice.subscriptionId}`
      );
    }

    if (subscription.status === 'canceled') {
      throw new Error('Cannot process payment for a canceled subscription');
    }


    const existingPayment =
  this.paymentRepository.findByInvoiceId(invoiceId);

const canRetryPendingPayment =
  existingPayment?.status === 'pending' &&
  existingPayment.id === paymentId;

if (existingPayment && !canRetryPendingPayment) {
  if (
    existingPayment.status !== 'failed' ||
    existingPayment.id === paymentId
  ) {
    throw new Error(
      `Payment already exists for invoice: ${invoiceId}`
    );
  }
}

const payment = canRetryPendingPayment
  ? existingPayment!
  : createPayment(
      paymentId,
      invoiceId,
      invoice.amountCents
    );

if (!canRetryPendingPayment) {
  this.paymentRepository.create(payment);
}

    // A provider timeout leaves the payment pending because
    // the actual payment outcome may be unknown.
    const result = await this.paymentProvider.charge({
      invoiceId: invoice.id,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      idempotencyKey: paymentId
    });

    if (!result.success) {
      this.paymentRepository.updateStatus(paymentId, 'failed');
      return this.paymentRepository.findById(paymentId);
    }

    // Apply successful payment updates atomically.
    this.db.run('BEGIN TRANSACTION');

    try {
      this.paymentRepository.updateStatus(
        paymentId,
        'succeeded',
        result.providerPaymentId
      );

      this.invoiceRepository.updateStatus(invoiceId, 'paid');

      const currentSubscription =
        this.subscriptionRepository.findById(invoice.subscriptionId);

      if (
        currentSubscription &&
        canTransition(currentSubscription.status, 'active')
      ) {
        const nextStatus = transitionSubscription(
          currentSubscription.status,
          'active'
        );

        this.subscriptionRepository.updateStatus(
          currentSubscription.id,
          nextStatus
        );
      }

      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }

    return this.paymentRepository.findById(paymentId);
  }
}
