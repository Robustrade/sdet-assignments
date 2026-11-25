
export type PaymentWebhookType =
  | 'payment.succeeded'
  | 'payment.failed';

interface BasePaymentWebhook {
  event_id: string;
  created_at: string;
  data: {
    invoice_id: string;
    subscription_id: string;
  };
}

export interface PaymentSucceededWebhook extends BasePaymentWebhook {
  event_type: 'payment.succeeded';
  data: BasePaymentWebhook['data'] & {
    provider_reference: string;
  };
}

export interface PaymentFailedWebhook extends BasePaymentWebhook {
  event_type: 'payment.failed';
  data: BasePaymentWebhook['data'] & {
    failure_reason: string;
  };
}

export type PaymentWebhook =
  | PaymentSucceededWebhook
  | PaymentFailedWebhook;
