import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';
import { InvoiceRepository } from '../../src/infrastructure/repositories/InvoiceRepository.js';
import type { Invoice } from '../../src/domain/Invoice.js';
import type { DatabaseSync } from 'node:sqlite';

describe('InvoiceRepository', () => {
    let db: DatabaseSync;
    let repository: InvoiceRepository;

    beforeEach(() => {
        db = createDatabase();
        repository = new InvoiceRepository(db);

        db.prepare(`
      INSERT INTO subscriptions (
        id,
        customer_id,
        plan,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
            'sub-001',
            'customer-001',
            'basic',
            'trialing',
            '2026-09-18T10:00:00.000Z',
            '2026-09-18T10:00:00.000Z'
        );
    });

    it('creates and retrieves an invoice by ID', () => {
        const invoice: Invoice = {
            id: 'inv-001',
            subscriptionId: 'sub-001',
            amount: 1900,
            currency: 'GBP',
            status: 'succeeded',
        };

        repository.create(invoice);

        expect(repository.getById('inv-001')).toEqual(invoice);

        db.close();
    });

    it('returns undefined when invoice does not exist', () => {
        expect(repository.getById('does-not-exist')).toBeUndefined();

        db.close();
    });

    it('retrieves invoices by subscription ID', () => {
        const invoices: Invoice[] = [
            {
                id: 'inv-001',
                subscriptionId: 'sub-001',
                amount: 1900,
                currency: 'GBP',
                status: 'succeeded',
            },
            {
                id: 'inv-002',
                subscriptionId: 'sub-001',
                amount: 1900,
                currency: 'GBP',
                status: 'failed',
            },
        ];

        invoices.forEach((invoice) => repository.create(invoice));

        expect(repository.getBySubscriptionId('sub-001')).toEqual(invoices);

        db.close();
    });

    it('updates invoice status', () => {
        const invoice: Invoice = {
            id: 'inv-001',
            subscriptionId: 'sub-001',
            amount: 1900,
            currency: 'GBP',
            status: 'pending',
        };

        repository.create(invoice);

        repository.updateStatus('inv-001', 'succeeded');

        expect(repository.getById('inv-001')).toEqual({
            ...invoice,
            status: 'succeeded',
        });

        db.close();
    });

    it('does not create an invoice with an invalid status', () => {
        const invoice = {
            id: 'inv-invalid',
            subscriptionId: 'sub-001',
            amount: 1900,
            currency: 'GBP',
            status: 'unknown',
        };

        expect(() => {
            repository.create(invoice as unknown as Invoice);
        }).toThrow();

        db.close();
    });
});