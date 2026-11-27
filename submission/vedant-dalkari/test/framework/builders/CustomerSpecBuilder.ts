/**
 * Fluent builder for customer seed fixtures.
 * Author: Vedant Dalkari
 */

import type { CustomerRecord } from '../../../src/domain/types.js';
import { DEFAULT_T0_ISO } from '../doubles/ControlledClock.js';

export class CustomerSpecBuilder {
  private id = 'cust_001';
  private email = 'alice@example.com';
  private name = 'Alice Merchant';
  private createdAt = DEFAULT_T0_ISO;

  public static create(): CustomerSpecBuilder {
    return new CustomerSpecBuilder();
  }

  public withId(id: string): this {
    this.id = id;
    return this;
  }

  public withEmail(email: string): this {
    this.email = email;
    return this;
  }

  public withName(name: string): this {
    this.name = name;
    return this;
  }

  public withCreatedAt(createdAt: string): this {
    this.createdAt = createdAt;
    return this;
  }

  public build(): CustomerRecord {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      created_at: this.createdAt,
    };
  }
}
