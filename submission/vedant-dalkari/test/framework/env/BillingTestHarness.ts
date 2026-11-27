/**
 * Factory and lifecycle container provisioning an isolated per-test WASM sql.js DB,
 * test doubles, SUT service wiring, typed clients, and automatic teardown InvariantGuard.
 * Author: Vedant Dalkari
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { LifecycleEngine } from '../../../src/domain/LifecycleEngine.js';
import { PlanPolicyRegistry } from '../../../src/domain/PlanPolicy.js';
import type { CustomerRecord } from '../../../src/domain/types.js';
import { createApp } from '../../../src/http/createApp.js';
import { AuditLogRepo } from '../../../src/persistence/AuditLogRepo.js';
import { CustomerRepo } from '../../../src/persistence/CustomerRepo.js';
import { InvoiceRepo } from '../../../src/persistence/InvoiceRepo.js';
import { PaymentAttemptRepo } from '../../../src/persistence/PaymentAttemptRepo.js';
import { SqliteDatabase } from '../../../src/persistence/SqliteDatabase.js';
import { SubscriptionRepo } from '../../../src/persistence/SubscriptionRepo.js';
import { WebhookEventRepo } from '../../../src/persistence/WebhookEventRepo.js';
import { BillingEngine } from '../../../src/services/BillingEngine.js';
import { SubscriptionService } from '../../../src/services/SubscriptionService.js';
import { WebhookProcessor } from '../../../src/services/WebhookProcessor.js';
import { CustomerSpecBuilder } from '../builders/CustomerSpecBuilder.js';
import { BillingApiClient } from '../clients/BillingApiClient.js';
import { WebhookClient } from '../clients/WebhookClient.js';
import { AuditSpyNotifier } from '../doubles/AuditSpyNotifier.js';
import { ControlledClock, DEFAULT_T0_ISO } from '../doubles/ControlledClock.js';
import { HmacWebhookSigner } from '../doubles/HmacWebhookSigner.js';
import { RecordingBillingGateway } from '../doubles/RecordingBillingGateway.js';
import { InvariantGuard } from '../verify/InvariantGuard.js';
import { LedgerInspector } from '../verify/LedgerInspector.js';
import { SubscriptionVerifier } from '../verify/SubscriptionVerifier.js';
import { ScenarioFixture } from './ScenarioFixture.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(THIS_DIR, '..', '..', '..');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'src', 'persistence', 'schema.sql');
const WASM_DIR = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');

let cachedSqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!cachedSqlJsPromise) {
    cachedSqlJsPromise = initSqlJs({
      locateFile: (file: string) => path.join(WASM_DIR, file),
    });
  }
  return cachedSqlJsPromise;
}

export interface HarnessOptions {
  readonly initialIso?: string;
  readonly customers?: readonly CustomerRecord[];
  readonly webhookSecret?: string;
}

export class BillingTestHarness {
  public readonly rawDb: Database;
  public readonly db: SqliteDatabase;
  public readonly clock: ControlledClock;
  public readonly gateway: RecordingBillingGateway;
  public readonly notifier: AuditSpyNotifier;
  public readonly signer: HmacWebhookSigner;
  public readonly lifecycleEngine: LifecycleEngine;
  public readonly planRegistry: PlanPolicyRegistry;
  public readonly customerRepo: CustomerRepo;
  public readonly subscriptionRepo: SubscriptionRepo;
  public readonly invoiceRepo: InvoiceRepo;
  public readonly paymentAttemptRepo: PaymentAttemptRepo;
  public readonly webhookEventRepo: WebhookEventRepo;
  public readonly auditLogRepo: AuditLogRepo;
  public readonly app: Express;
  public readonly api: BillingApiClient;
  public readonly webhooks: WebhookClient;
  public readonly ledger: LedgerInspector;
  public readonly verifier: SubscriptionVerifier;
  public readonly invariants: InvariantGuard;
  public readonly scenario: ScenarioFixture;

  private disposed = false;

  private constructor(params: {
    rawDb: Database;
    db: SqliteDatabase;
    clock: ControlledClock;
    gateway: RecordingBillingGateway;
    notifier: AuditSpyNotifier;
    signer: HmacWebhookSigner;
    lifecycleEngine: LifecycleEngine;
    planRegistry: PlanPolicyRegistry;
    customerRepo: CustomerRepo;
    subscriptionRepo: SubscriptionRepo;
    invoiceRepo: InvoiceRepo;
    paymentAttemptRepo: PaymentAttemptRepo;
    webhookEventRepo: WebhookEventRepo;
    auditLogRepo: AuditLogRepo;
    app: Express;
  }) {
    this.rawDb = params.rawDb;
    this.db = params.db;
    this.clock = params.clock;
    this.gateway = params.gateway;
    this.notifier = params.notifier;
    this.signer = params.signer;
    this.lifecycleEngine = params.lifecycleEngine;
    this.planRegistry = params.planRegistry;
    this.customerRepo = params.customerRepo;
    this.subscriptionRepo = params.subscriptionRepo;
    this.invoiceRepo = params.invoiceRepo;
    this.paymentAttemptRepo = params.paymentAttemptRepo;
    this.webhookEventRepo = params.webhookEventRepo;
    this.auditLogRepo = params.auditLogRepo;
    this.app = params.app;

    this.api = new BillingApiClient(this.app);
    this.webhooks = new WebhookClient(this.app);
    this.ledger = new LedgerInspector(this.rawDb);
    this.verifier = new SubscriptionVerifier(this.ledger, this.gateway, this.notifier, this.api);
    this.invariants = new InvariantGuard(this.ledger, this.gateway, this.api);
    this.scenario = new ScenarioFixture(
      this.api,
      this.gateway,
      this.clock,
      this.ledger,
    );
  }

  public static async create(options: HarnessOptions = {}): Promise<BillingTestHarness> {
    const SQL = await getSqlJs();
    const rawDb = new SQL.Database();
    rawDb.run('PRAGMA foreign_keys = ON;');

    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    rawDb.run(schemaSql);

    const db = new SqliteDatabase(rawDb);
    const clock = new ControlledClock(options.initialIso ?? DEFAULT_T0_ISO);
    const gateway = new RecordingBillingGateway();
    const notifier = new AuditSpyNotifier();
    const webhookSecret = options.webhookSecret ?? HmacWebhookSigner.DEFAULT_SECRET;
    const signer = new HmacWebhookSigner(webhookSecret);

    const lifecycleEngine = new LifecycleEngine();
    const planRegistry = new PlanPolicyRegistry();

    const customerRepo = new CustomerRepo(db);
    const subscriptionRepo = new SubscriptionRepo(db);
    const invoiceRepo = new InvoiceRepo(db);
    const paymentAttemptRepo = new PaymentAttemptRepo(db);
    const webhookEventRepo = new WebhookEventRepo(db);
    const auditLogRepo = new AuditLogRepo(db);

    const subscriptionService = new SubscriptionService({
      db,
      customerRepo,
      subscriptionRepo,
      invoiceRepo,
      paymentAttemptRepo,
      auditLogRepo,
      lifecycleEngine,
      planRegistry,
      billingGateway: gateway,
      clock,
      notifier,
    });

    const billingEngine = new BillingEngine({
      db,
      subscriptionRepo,
      invoiceRepo,
      paymentAttemptRepo,
      auditLogRepo,
      lifecycleEngine,
      planRegistry,
      billingGateway: gateway,
      clock,
      notifier,
    });

    const webhookProcessor = new WebhookProcessor({
      db,
      subscriptionRepo,
      invoiceRepo,
      paymentAttemptRepo,
      webhookEventRepo,
      auditLogRepo,
      lifecycleEngine,
      planRegistry,
      clock,
      notifier,
      webhookSecret,
    });

    const app = createApp({
      subscriptionService,
      billingEngine,
      webhookProcessor,
    });

    const harness = new BillingTestHarness({
      rawDb,
      db,
      clock,
      gateway,
      notifier,
      signer,
      lifecycleEngine,
      planRegistry,
      customerRepo,
      subscriptionRepo,
      invoiceRepo,
      paymentAttemptRepo,
      webhookEventRepo,
      auditLogRepo,
      app,
    });

    const defaultCustomers: readonly CustomerRecord[] = options.customers ?? [
      CustomerSpecBuilder.create().withId('cust_001').withEmail('cust1@example.com').withName('Customer One').build(),
      CustomerSpecBuilder.create().withId('cust_002').withEmail('cust2@example.com').withName('Customer Two').build(),
      CustomerSpecBuilder.create().withId('cust_003').withEmail('cust3@example.com').withName('Customer Three').build(),
    ];

    if (harness.ledger.hasTable('customers')) {
      for (const customer of defaultCustomers) {
        harness.ledger.executeRaw(
          'INSERT INTO customers (id, email, name, created_at) VALUES (?, ?, ?, ?)',
          [customer.id, customer.email, customer.name, customer.created_at],
        );
      }
    }

    return harness;
  }

  public async dispose(options: { readonly skipInvariants?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      if (!options.skipInvariants && this.ledger.hasAllBillingTables()) {
        await this.invariants.assertAll();
      }
    } finally {
      this.db.close();
    }
  }
}
