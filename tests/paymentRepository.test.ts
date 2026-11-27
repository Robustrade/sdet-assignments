
import { PaymentRepository } from '../src/repositories/paymentRepository';

describe('PaymentRepository', () => {
  let repository: PaymentRepository;

  const payment = {
    id: 'pay_1',
    invoiceId: 'inv_1',
    subscriptionId: 'sub_1',
    amountCents: 99900,
    status: 'success' as const,
    transactionId: 'txn_1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    repository = new PaymentRepository();
  });

  test('should save a payment', () => {
    repository.save(payment);
    expect(repository.findById('pay_1')).toEqual(payment);
  });

  test('should return undefined for unknown payment', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });

  test('should find payments by invoice ID', () => {
    repository.save(payment);
    expect(repository.findByInvoiceId('inv_1')).toEqual([payment]);
  });

  test('should return all payments', () => {
    repository.save(payment);
    expect(repository.findAll()).toEqual([payment]);
  });

  test('should delete a payment', () => {
    repository.save(payment);
    expect(repository.delete('pay_1')).toBe(true);
  });
});
