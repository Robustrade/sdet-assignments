import type { Invoice } from '../../src/domain/models/invoice';
import { InMemoryInvoiceRepository } from '../../src/infrastructure/persistence/in-memory-invoice-repository';

describe('InMemoryInvoiceRepository', () => {
  const createInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
    id: 'inv_001',
    subscriptionId: 'sub_001',
    amount: 4900,
    currency: 'USD',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('findById() returns undefined when the invoice does not exist', () => {
    const repository = new InMemoryInvoiceRepository();

    expect(repository.findById('missing-invoice')).toBeUndefined();
  });

  it('save() persists an invoice and findById() returns the same invoice', () => {
    const repository = new InMemoryInvoiceRepository();
    const invoice = createInvoice();

    repository.save(invoice);

    expect(repository.findById(invoice.id)).toEqual(invoice);
  });

  it('delete() removes an existing invoice', () => {
    const repository = new InMemoryInvoiceRepository();
    const invoice = createInvoice();

    repository.save(invoice);
    repository.delete(invoice.id);

    expect(repository.findById(invoice.id)).toBeUndefined();
  });

  it('saving an invoice with the same ID replaces the previous invoice', () => {
    const repository = new InMemoryInvoiceRepository();
    const original = createInvoice({ id: 'inv_001', status: 'pending' });
    const replacement = createInvoice({
      id: 'inv_001',
      subscriptionId: 'sub_002',
      amount: 5900,
      currency: 'USD',
      status: 'paid',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    repository.save(original);
    repository.save(replacement);

    expect(repository.findById('inv_001')).toEqual(replacement);
  });
});
