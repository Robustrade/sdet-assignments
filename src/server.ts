import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { createDb } from './persistence/db.js';
import { SubscriptionRepository } from './persistence/SubscriptionRepository.js';
import { InvoiceRepository } from './persistence/InvoiceRepository.js';
import { WebhookEventRepository } from './persistence/WebhookEventRepository.js';
import { PlanCatalog } from './domain/PlanCatalog.js';
import { PLANS } from './domain/Plan.js';
import { SubscriptionService } from './services/SubscriptionService.js';
import { WebhookService } from './services/WebhookService.js';
import type { PaymentProviderPort } from './payment/PaymentProviderPort.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/billing.db';
const secret = process.env.WEBHOOK_SIGNING_SECRET ?? 'dev-secret';

if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const db = createDb(dbPath);
const plans = new PlanCatalog(PLANS);
const subscriptions = new SubscriptionRepository(db);
const invoices = new InvoiceRepository(db);
const webhookEvents = new WebhookEventRepository(db);

const devProvider: PaymentProviderPort = {
  async charge() {
    throw new Error('no real payment provider in the fixture; use the test harness');
  },
};

const app = createApp({
  subscriptionService: new SubscriptionService(plans, devProvider, subscriptions, invoices),
  webhookService: new WebhookService(secret, subscriptions, invoices, webhookEvents, plans),
});

app.listen(port, () => {
  console.log(`Subscription & Billing service listening on http://localhost:${port}`);
});