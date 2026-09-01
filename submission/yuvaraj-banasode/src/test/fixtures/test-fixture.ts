/**
 * Test Fixture Factory
 * 
 * Centralizes environment setup for all tests:
 * - Creates service instance with mocked dependencies
 * - Seeds test data (customers, plans)
 * - Provides repositories and assertion helpers
 * - Manages cleanup and isolation
 */

import { Express } from 'express';
import { InMemoryDatabase } from '../../infrastructure/in-memory-database';
import { MockPaymentProvider } from '../../domain/payment-provider';
import { SubscriptionService } from '../../domain/services/subscription-service';
import { WebhookProcessor } from '../../domain/services/webhook-processor';
import { createApp } from '../../app';
import {
  SubscriptionRepository,
  InvoiceRepository,
  WebhookEventRepository,
} from '../repositories/index';
import {
  APIAssertions,
  PersistenceAssertions,
  ProviderAssertions,
} from '../helpers/assertions';
import { Customer } from '../../types';
import { PlanRegistry } from '../../domain/plan-registry';

export interface ProviderCall {
  customerId: string;
  amount: number;
  idempotencyKey: string;
  timestamp: Date;
}

export class TestFixture {
  private db: InMemoryDatabase;
  private mockPaymentProvider: MockPaymentProvider;
  private subscriptionService: SubscriptionService;
  private webhookProcessor: WebhookProcessor;
  
  public app: Express;
  public subscriptionRepo: SubscriptionRepository;
  public invoiceRepo: InvoiceRepository;
  public webhookRepo: WebhookEventRepository;
  public persistenceAssertions: PersistenceAssertions;
  public providerAssertions: ProviderAssertions;

  private testCustomers: Map<string, Customer> = new Map();

  constructor() {
    // Initialize in-memory database
    this.db = new InMemoryDatabase();

    // Initialize mocked payment provider
    this.mockPaymentProvider = new MockPaymentProvider();

    // Initialize services
    this.subscriptionService = new SubscriptionService(
      this.db,
      this.mockPaymentProvider
    );
    this.webhookProcessor = new WebhookProcessor(this.db, this.subscriptionService);

    // Initialize Express app
    this.app = createApp(this.subscriptionService, this.webhookProcessor);

    // Initialize repositories
    this.subscriptionRepo = new SubscriptionRepository(this.db);
    this.invoiceRepo = new InvoiceRepository(this.db);
    this.webhookRepo = new WebhookEventRepository(this.db);

    // Initialize assertion helpers
    this.persistenceAssertions = new PersistenceAssertions(
      this.subscriptionRepo,
      this.invoiceRepo,
      this.webhookRepo
    );
    this.providerAssertions = new ProviderAssertions(this.mockPaymentProvider);
  }

  /**
   * Seed a test customer
   */
  seedCustomer(id: string, name: string, email: string): Customer {
    const customer: Customer = {
      id,
      name,
      email,
      createdAt: new Date(),
    };
    this.db.saveCustomer(customer);
    this.testCustomers.set(id, customer);
    return customer;
  }

  /**
   * Get or create a default test customer
   */
  getDefaultCustomer(): Customer {
    const customerId = 'cust_default';
    if (this.testCustomers.has(customerId)) {
      return this.testCustomers.get(customerId)!;
    }
    return this.seedCustomer(customerId, 'Test Customer', 'test@example.com');
  }

  /**
   * Configure next payment provider outcome
   */
  setNextPaymentOutcome(outcome: 'success' | 'decline' | 'timeout') {
    this.mockPaymentProvider.setNextOutcome(outcome);
  }

  /**
   * Get all recorded payment provider calls (for debugging)
   */
  getPaymentProviderCalls(): ProviderCall[] {
    return this.mockPaymentProvider.getAllCalls();
  }

  /**
   * Reset the entire test fixture
   */
  async teardown(): Promise<void> {
    // Clear database
    this.db.clear();
    
    // Reset mock provider
    this.mockPaymentProvider.reset();

    // Clear test customers
    this.testCustomers.clear();
  }
}

/**
 * Global fixture instance (created per test via beforeEach)
 */
let currentFixture: TestFixture;

export function useTestFixture(): TestFixture {
  return currentFixture;
}

export function setCurrentFixture(fixture: TestFixture) {
  currentFixture = fixture;
}
