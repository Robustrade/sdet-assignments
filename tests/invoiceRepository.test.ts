
import { InvoiceRepository } from '../src/repositories/invoiceRepository';

describe('InvoiceRepository', () => {
  let repository: InvoiceRepository;

  const invoice = {
    id: 'inv_1',
    subscriptionId: 'sub_1',
    customerId: 'customer_1',
    amountCents: 99900,
    status: 'pending' as const,
    createdAt: new Date(),
  };

  beforeEach(() => {
    repository = new InvoiceRepository();
  });

  test('should save an invoice', () => {
    repository.save(invoice);
    expect(repository.findById('inv_1')).toEqual(invoice);
  });

  test('should return undefined for unknown invoice', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });

  test('should find invoices by subscription ID', () => {
    repository.save(invoice);
    expect(repository.findBySubscriptionId('sub_1')).toEqual([invoice]);
  });

  test('should return all invoices', () => {
    repository.save(invoice);
    expect(repository.findAll()).toEqual([invoice]);
  });

  test('should delete an invoice', () => {
    repository.save(invoice);
    expect(repository.delete('inv_1')).toBe(true);
    expect(repository.findById('inv_1')).toBeUndefined();
  });
});
