
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { createTestContext } from '../fixtures/testContext.js';
import { ApiAssertions } from './ApiAssertions.js';
import { DatabaseAssertions } from './DatabaseAssertions.js';

import request from 'supertest';

describe('Assertion Helpers', () => {
  let context: ReturnType<typeof createTestContext>;
  let databaseAssertions: DatabaseAssertions;

  beforeEach(() => {
    context = createTestContext();

    databaseAssertions = new DatabaseAssertions(
      context.database.connection
    );
  });

  afterEach(() => {
    context.cleanup();
  });

  describe('ApiAssertions', () => {
    it('should validate successful API responses', async () => {
      const response = await request(context.app).get('/health');

      expect(() => {
        ApiAssertions.assertSuccess(response, 200);
      }).not.toThrow();
    });

    it('should validate failed API responses', async () => {
      const response = await request(context.app)
        .get('/subscriptions/unknown');

      expect(() => {
        ApiAssertions.assertFailure(response, 404);
      }).not.toThrow();
    });

    it('should validate error messages', async () => {
      const response = await request(context.app)
        .get('/subscriptions/unknown');

      expect(() => {
        ApiAssertions.assertHasErrorMessage(response);
      }).not.toThrow();
    });
  });

  describe('DatabaseAssertions', () => {
    it('should verify seeded customers exist', () => {
      expect(() => {
        databaseAssertions.assertRecordExists(
          'customers',
          'id',
          'cust_001'
        );
      }).not.toThrow();
    });

    it('should verify a nonexistent record does not exist', () => {
      expect(() => {
        databaseAssertions.assertRecordDoesNotExist(
          'subscriptions',
          'id',
          'sub_missing'
        );
      }).not.toThrow();
    });

    it('should verify database record counts', () => {
      expect(() => {
        databaseAssertions.assertRecordCount('customers', 2);
      }).not.toThrow();
    });

    it('should verify a database column value', () => {
      expect(() => {
        databaseAssertions.assertColumnValue(
          'customers',
          'id',
          'cust_001',
          'email',
          'customer1@example.com'
        );
      }).not.toThrow();
    });
  });
});
