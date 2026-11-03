import { z } from 'zod';

/**
 * Response contracts, written from the API documentation (docs/TEST_STRATEGY.md §3) rather than
 * derived from the service code. Strict: an extra or missing field is a contract break.
 */
const isoTimestamp = z.string().datetime();

export const InvoiceSummaryContract = z
  .object({
    id: z.string().startsWith('inv_'),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    status: z.enum(['open', 'paid', 'uncollectible', 'void', 'refunded']),
  })
  .strict();

export const SubscriptionContract = z
  .object({
    id: z.string().startsWith('sub_'),
    customer_id: z.string(),
    payment_method_id: z.string(),
    plan: z.enum(['basic', 'pro']),
    status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
    trial_ends_at: isoTimestamp.nullable(),
    current_period_start: isoTimestamp.nullable(),
    current_period_end: isoTimestamp.nullable(),
    next_billing_at: isoTimestamp.nullable(),
    retry_count: z.number().int().nonnegative(),
    canceled_at: isoTimestamp.nullable(),
    cancel_reason: z.enum(['customer_request', 'retries_exhausted']).nullable(),
    created_at: isoTimestamp,
    updated_at: isoTimestamp,
    latest_invoice: InvoiceSummaryContract.nullable(),
  })
  .strict();

export const InvoiceContract = z
  .object({
    id: z.string().startsWith('inv_'),
    subscription_id: z.string().startsWith('sub_'),
    plan: z.string(),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    status: z.enum(['open', 'paid', 'uncollectible', 'void', 'refunded']),
    period_start: isoTimestamp,
    period_end: isoTimestamp,
    created_at: isoTimestamp,
    paid_at: isoTimestamp.nullable(),
  })
  .strict();

export const InvoiceListContract = z.object({ data: z.array(InvoiceContract) }).strict();

export const ErrorContract = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.array(z.object({ field: z.string(), issue: z.string() }).strict()).optional(),
      })
      .strict(),
  })
  .strict();

export const WebhookAckContract = z
  .object({
    received: z.literal(true),
    event_id: z.string(),
    outcome: z.enum(['applied', 'ignored', 'duplicate']),
    reason: z.string().optional(),
  })
  .strict();

export const BillingRunContract = z
  .object({
    results: z.array(
      z
        .object({
          subscription_id: z.string(),
          invoice_id: z.string().nullable(),
          outcome: z.string(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type SubscriptionDto = z.infer<typeof SubscriptionContract>;
export type InvoiceDto = z.infer<typeof InvoiceContract>;
export type ErrorDto = z.infer<typeof ErrorContract>;
export type WebhookAckDto = z.infer<typeof WebhookAckContract>;
export type BillingRunDto = z.infer<typeof BillingRunContract>;
