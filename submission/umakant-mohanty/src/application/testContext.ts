import { SubscriptionService } from './service';
import { SubscriptionStateMachine } from '../domain/stateMachine';
import { MockPaymentProvider } from '../infrastructure/paymentProvider';
import { InMemoryRepository } from '../infrastructure/repository';

export class TestContext {
  readonly repo = new InMemoryRepository();
  readonly provider = new MockPaymentProvider();
  readonly stateMachine = new SubscriptionStateMachine();
  readonly service = new SubscriptionService(this.repo, this.provider, this.stateMachine);
  reset(): void {
    this.repo.reset();
    this.provider.reset();
    this.service.reset();
    this.repo.addCustomer({ id: 'cust_001' });
    this.repo.addCustomer({ id: 'cust_002' });
    this.repo.addPlan({ code: 'basic', priceCents: 1000, trialDays: 0 });
    this.repo.addPlan({ code: 'pro', priceCents: 4900, trialDays: 14 });
  }
}
