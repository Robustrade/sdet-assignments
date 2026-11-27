import { PaymentService } from '../src/services/paymentService';
import { MockPaymentProvider } from '../src/providers/paymentProvider';

describe('PaymentService', () => {
  let provider: MockPaymentProvider;
  let service: PaymentService;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    service = new PaymentService(provider);
  });

  test('should process successful payment', async () => {
    const result = await service.makePayment(99900);

    expect(result.status).toBe('success');
  });

  test('should handle declined payment', async () => {
    provider.setNextResult('declined');

    const result = await service.makePayment(99900);

    expect(result.status).toBe('declined');
  });

  test('should handle payment timeout', async () => {
    provider.setNextResult('timeout');

    const result = await service.makePayment(99900);

    expect(result.status).toBe('timeout');
  });

  test('should reject invalid payment amount', async () => {
    const result = await service.makePayment(0);

    expect(result.status).toBe('declined');
  });
});