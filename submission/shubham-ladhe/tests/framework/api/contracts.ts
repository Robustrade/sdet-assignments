import { z } from 'zod';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s, 'ISO-8601 UTC timestamp');

/** What clients are promised. Every response the API client sees is checked against these. */
export const subscriptionContract = z
  .object({
    id: z.string().regex(/^sub_/),
    customer_id: z.string(),
    plan: z.enum(['basic', 'pro']),
    status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
    payment_method_id: z.string(),
    amount: z.number().int().positive(),
    currency: z.literal('USD'),
    trial_ends_at: isoDate.nullable(),
    current_period_start: isoDate,
    current_period_end: isoDate,
    canceled_at: isoDate.nullable(),
    cancel_reason: z.string().nullable(),
    created_at: isoDate,
    latest_invoice: z
      .object({
        id: z.string().regex(/^inv_/),
        status: z.enum(['open', 'paid', 'uncollectible', 'void', 'refunded']),
        amount: z.number().int().positive(),
        failed_attempts: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SubscriptionBody = z.infer<typeof subscriptionContract>;

export const errorContract = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorBody = z.infer<typeof errorContract>;

export const webhookReceiptContract = z
  .object({
    event_id: z.string(),
    outcome: z.enum(['processed', 'ignored', 'duplicate']),
    reason: z.string().optional(),
  })
  .strict();
export type WebhookReceiptBody = z.infer<typeof webhookReceiptContract>;
