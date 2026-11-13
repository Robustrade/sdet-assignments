import { SubscriptionRecord } from '../persistence/repository';
import { randomUUID } from 'crypto';

export class SubscriptionBuilder {
  private record: SubscriptionRecord = {
    id: `sub_${randomUUID().substring(0, 8)}`,
    customerId: 'cust_001',
    plan: 'pro',
    status: 'trialing',
    paymentMethodId: 'pm_test_visa_4242',
    createdAt: new Date(),
  };

  publicwithId(id: string): this {
    this.record.id = id;
    return this;
  }

  public withCustomerId(customerId: string): this {
    this.record.customerId = customerId;
    return this;
  }

  public withPlan(plan: string): this {
    this.record.plan = plan;
    return this;
  }

  public withStatus(status: SubscriptionRecord['status']): this {
    this.record.status = status;
    return this;
  }

  public withPaymentMethod(pmId: string): this {
    this.record.paymentMethodId = pmId;
    return this;
  }

  public build(): SubscriptionRecord {
    return { ...this.record };
  }
}