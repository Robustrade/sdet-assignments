
import type { Customer, Plan } from '../src/models.js';

export class CustomerBuilder {
  private customer: Customer = {
    id: 'cust_001',
    email: 'test@example.com',
  };

  withId(id: string): this {
    this.customer.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.customer.email = email;
    return this;
  }

  build(): Customer {
    return { ...this.customer };
  }
}

export class PlanBuilder {
  private plan: Plan = {
    name: 'basic',
    price: 1900,
    currency: 'USD',
    trialDays: 14,
    chargeImmediately: false,
  };

  withName(name: Plan['name']): this {
    this.plan.name = name;
    return this;
  }

  withPrice(price: number): this {
    this.plan.price = price;
    return this;
  }

  withTrialDays(days: number): this {
    this.plan.trialDays = days;
    return this;
  }

  withImmediateCharge(value: boolean): this {
    this.plan.chargeImmediately = value;
    return this;
  }

  build(): Plan {
    return { ...this.plan };
  }
}
