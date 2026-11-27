/**
 * Fluent builder for POST /subscriptions request payloads (valid & negative cases).
 * Author: Vedant Dalkari
 */

import type { PlanCode } from '../../../src/domain/types.js';
import type { CreateSubscriptionPayload } from '../clients/contracts.js';

export class SignupPayloadBuilder {
  private customerId = 'cust_001';
  private plan: string = 'starter';
  private paymentMethodId: string | undefined = 'pm_visa_4242';
  private overrides: Record<string, unknown> = {};
  private omittedFields = new Set<string>();

  public static create(): SignupPayloadBuilder {
    return new SignupPayloadBuilder();
  }

  public forCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  public withPlan(plan: string): this {
    this.plan = plan;
    return this;
  }

  public withStarterPlan(): this {
    this.plan = 'starter';
    return this;
  }

  public withGrowthPlan(): this {
    this.plan = 'growth';
    return this;
  }

  public withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  public withoutField(field: 'customer_id' | 'plan' | 'payment_method_id'): this {
    this.omittedFields.add(field);
    return this;
  }

  public withRawOverrides(overrides: Record<string, unknown>): this {
    this.overrides = { ...this.overrides, ...overrides };
    return this;
  }

  public build(): CreateSubscriptionPayload {
    return {
      customer_id: this.customerId,
      plan: this.plan as PlanCode,
      payment_method_id: this.paymentMethodId ?? 'pm_visa_4242',
    };
  }

  public buildUntyped(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      customer_id: this.customerId,
      plan: this.plan,
      payment_method_id: this.paymentMethodId,
      ...this.overrides,
    };
    for (const key of this.omittedFields) {
      delete base[key];
    }
    return base;
  }
}
