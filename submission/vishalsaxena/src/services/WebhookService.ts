import { InvoiceRepository } from '../repositories/InvoiceRepository';
import { PaymentRepository } from '../repositories/PaymentRepository';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { WebhookRepository } from '../repositories/WebhookRepository';
import { verifyWebhookSignature } from '../utils/webhookSignature';
import { webhookConfig } from '../config/webhook.config';
import { AppDatabase } from '../database/database';
import { canTransition } from '../state/SubscriptionStateMachine';

interface PaymentWebhookPayload {
    event_id: string;
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
    subscription_id: string;
    invoice_id: string;
    amount: number;
    currency: string;
  }

export class WebhookService {
    constructor(
        private db: AppDatabase,
        private webhookRepository: WebhookRepository,
        private invoiceRepository: InvoiceRepository,
        private paymentRepository: PaymentRepository,
        private subscriptionRepository: SubscriptionRepository
      ) {}

  process(
    rawBody: string,
    signature: string
  ): { received: boolean; duplicate: boolean } {
    // 1. Verify webhook signature
    const isValid = verifyWebhookSignature(
      rawBody,
      signature,
      webhookConfig.secret
    );
  
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }
  
    // 2. Parse payload
    let payload: PaymentWebhookPayload;
  
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error('Invalid webhook payload');
    }
  
    // 3. Validate required fields
    if (
      !payload.event_id ||
      !payload.subscription_id ||
      !payload.invoice_id ||
      !payload.type ||
      !Number.isInteger(payload.amount) ||
      payload.amount < 0 ||
      !payload.currency
    ) {
      throw new Error('Invalid webhook payload');
    }
  
    const supportedEvents = [
      'payment.succeeded',
      'payment.failed',
      'payment.refunded'
    ];
  
    if (!supportedEvents.includes(payload.type)) {
      throw new Error('Unsupported webhook event type');
    }

    const invoice = this.invoiceRepository.findById(payload.invoice_id);

if (!invoice) {
  throw new Error(`Invoice not found: ${payload.invoice_id}`);
}

const subscription = this.subscriptionRepository.findById(
  payload.subscription_id
);

if (!subscription) {
  throw new Error(`Subscription not found: ${payload.subscription_id}`);
}

if (invoice.subscriptionId !== payload.subscription_id) {
  throw new Error('Invoice does not belong to subscription');
}

if (
  invoice.amountCents !== payload.amount ||
  invoice.currency !== payload.currency
) {
  throw new Error('Webhook payment details do not match invoice');
}

const payment = this.paymentRepository.findByInvoiceId(
  payload.invoice_id
);

if (!payment) {
  throw new Error(`Payment not found for invoice: ${payload.invoice_id}`);
}

    this.db.run('BEGIN TRANSACTION');

try {

  const existingEvent =
  this.webhookRepository.findByProviderEventId(payload.event_id);

if (existingEvent) {
  this.db.run('ROLLBACK');

  return {
    received: true,
    duplicate: true
  };
}


    this.webhookRepository.create({
        id: `wh_${payload.event_id}`,
        providerEventId: payload.event_id,
        eventType: payload.type,
        payload,
        status: 'received'
      });

  if (payload.type === 'payment.succeeded') {
    if (
      payment.status === 'pending' ||
      payment.status === 'failed'
    ) {
      this.paymentRepository.updateStatus(
        payment.id,
        'succeeded'
      );

      this.invoiceRepository.updateStatus(
        invoice.id,
        'paid'
      );
    }

    // Never reactivate a canceled subscription.
    if (canTransition(subscription.status, 'active')) {
      this.subscriptionRepository.updateStatus(
        subscription.id,
        'active'
      );
    }
  }

  if (payload.type === 'payment.failed') {
    // A late failure must not reverse a successful payment.
    if (payment.status === 'pending') {
      this.paymentRepository.updateStatus(
        payment.id,
        'failed'
      );

      if (canTransition(subscription.status, 'past_due')) {
        this.subscriptionRepository.updateStatus(
          subscription.id,
          'past_due'
        );
      }
    }
  }

  if (payload.type === 'payment.refunded') {
    if (payment.status === 'succeeded') {
      this.paymentRepository.updateStatus(
        payment.id,
        'refunded'
      );
    }
  }

  this.webhookRepository.updateStatus(
    payload.event_id,
    'processed'
  );

  this.db.run('COMMIT');
} catch (error) {
  this.db.run('ROLLBACK');
  throw error;
}
  
    return {
      received: true,
      duplicate: false
    };
  }
}