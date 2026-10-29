import { decideBilling } from '../../../src/domain/billingSchedule';
import type { SubscriptionStatus } from '../../../src/domain/Subscription';
import { anInvoiceRecord } from '../../framework/builders/InvoiceRecordBuilder';
import { aSubscriptionRecord } from '../../framework/builders/SubscriptionRecordBuilder';

/**
 * The timing rules of billing as a pure function: given a subscription, its invoices and "now", what
 * (if anything) must be charged? No repositories, no provider, no clock object.
 *
 * The periods are written out here on purpose (30-day billing period, 1-day retry interval) so the
 * spec states the business rule independently of the constants in `src`.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);
const iso = (offsetMs: number): string => at(offsetMs).toISOString();

const subscription = (status: SubscriptionStatus, trialEndsAtMs = 14 * DAY) =>
  aSubscriptionRecord().inStatus(status).trialEndingAt(iso(trialEndsAtMs)).build();

describe('decideBilling: when is a charge due?', () => {
  describe('canceled', () => {
    it.each(['pending', 'failed', 'paid'] as const)('never bills, even with a %s invoice that is long overdue', (status) => {
      const invoices = [anInvoiceRecord().withStatus(status).at(iso(0)).build()];
      expect(decideBilling(subscription('canceled'), invoices, at(365 * DAY))).toEqual({ action: 'none' });
    });
  });

  describe('trialing', () => {
    it('does not bill while the trial is running', () => {
      expect(decideBilling(subscription('trialing'), [], at(14 * DAY - 1))).toEqual({ action: 'none' });
    });

    it('bills attempt 1 exactly when the trial ends', () => {
      expect(decideBilling(subscription('trialing'), [], at(14 * DAY))).toEqual({ action: 'charge_new', attempt: 1 });
    });

    it('keeps billing after the trial ended (a missed run is caught up, not skipped)', () => {
      expect(decideBilling(subscription('trialing'), [], at(40 * DAY))).toEqual({ action: 'charge_new', attempt: 1 });
    });

    it('resumes the pending invoice of an unanswered charge instead of creating a second one', () => {
      const pending = anInvoiceRecord().pending().at(iso(14 * DAY)).build();
      expect(decideBilling(subscription('trialing'), [pending], at(14 * DAY + 5))).toEqual({
        action: 'resume_pending',
        invoice: pending,
      });
    });

    it('does not touch a pending invoice before the trial has ended', () => {
      const pending = anInvoiceRecord().pending().build();
      expect(decideBilling(subscription('trialing'), [pending], at(1 * DAY))).toEqual({ action: 'none' });
    });
  });

  describe('active (recurring charge)', () => {
    const paidAtDay0 = anInvoiceRecord().paid().at(iso(0)).build();

    it('does not bill without a payment on record', () => {
      expect(decideBilling(subscription('active'), [], at(365 * DAY))).toEqual({ action: 'none' });
    });

    it('does not bill one millisecond before the 30-day period is over', () => {
      expect(decideBilling(subscription('active'), [paidAtDay0], at(30 * DAY - 1))).toEqual({ action: 'none' });
    });

    it('bills the next attempt exactly 30 days after the last payment', () => {
      expect(decideBilling(subscription('active'), [paidAtDay0], at(30 * DAY))).toEqual({
        action: 'charge_new',
        attempt: 2,
      });
    });

    it('measures the period from the latest payment, not the first', () => {
      const secondPayment = anInvoiceRecord().withId('inv_2').attempt(2).paid().at(iso(30 * DAY)).build();
      expect(decideBilling(subscription('active'), [paidAtDay0, secondPayment], at(59 * DAY))).toEqual({
        action: 'none',
      });
      expect(decideBilling(subscription('active'), [paidAtDay0, secondPayment], at(60 * DAY))).toEqual({
        action: 'charge_new',
        attempt: 3,
      });
    });

    it('treats a refunded invoice as a payment that happened', () => {
      const refunded = anInvoiceRecord().refunded().at(iso(0)).build();
      expect(decideBilling(subscription('active'), [refunded], at(30 * DAY))).toEqual({
        action: 'charge_new',
        attempt: 2,
      });
    });

    it('resumes a pending recurring invoice at any time', () => {
      const pending = anInvoiceRecord().withId('inv_2').attempt(2).pending().at(iso(30 * DAY)).build();
      expect(decideBilling(subscription('active'), [paidAtDay0, pending], at(30 * DAY + 1))).toEqual({
        action: 'resume_pending',
        invoice: pending,
      });
    });
  });

  describe('past_due (retry)', () => {
    const failedAtDay0 = anInvoiceRecord().failed().at(iso(0)).build();

    it('does not retry one millisecond before the 1-day retry interval is over', () => {
      expect(decideBilling(subscription('past_due'), [failedAtDay0], at(1 * DAY - 1))).toEqual({ action: 'none' });
    });

    it('retries exactly 1 day after the last failure', () => {
      expect(decideBilling(subscription('past_due'), [failedAtDay0], at(1 * DAY))).toEqual({
        action: 'charge_new',
        attempt: 2,
      });
    });

    it('measures the interval from the latest failure', () => {
      const secondFailure = anInvoiceRecord().withId('inv_2').attempt(2).failed().at(iso(1 * DAY)).build();
      expect(decideBilling(subscription('past_due'), [failedAtDay0, secondFailure], at(2 * DAY - 1))).toEqual({
        action: 'none',
      });
      expect(decideBilling(subscription('past_due'), [failedAtDay0, secondFailure], at(2 * DAY))).toEqual({
        action: 'charge_new',
        attempt: 3,
      });
    });

    it('resumes a pending retry invoice regardless of the interval', () => {
      const pending = anInvoiceRecord().withId('inv_2').attempt(2).pending().at(iso(1 * DAY)).build();
      expect(decideBilling(subscription('past_due'), [failedAtDay0, pending], at(1 * DAY + 1))).toEqual({
        action: 'resume_pending',
        invoice: pending,
      });
    });

    it('has nothing to retry without a failed invoice', () => {
      expect(decideBilling(subscription('past_due'), [], at(365 * DAY))).toEqual({ action: 'none' });
    });
  });
});
