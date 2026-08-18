import { test, expect } from '@playwright/test';
import { CustomerBuilder } from '../../src/builders/customer-builder';

test('CustomerBuilder should create customer test data', () => {
  const customer = new CustomerBuilder()
    .withId('cust_001')
    .withName('John Doe')
    .withEmail('john@example.com')
    .build();

  expect(customer).toEqual({
    id: 'cust_001',
    name: 'John Doe',
    email: 'john@example.com',
  });
});
