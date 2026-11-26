import { BillingDatabase } from './database.js';
import { PlanStrategyResolver } from './PlanStrategy.js';

const testDb = new BillingDatabase(':memory:');
const tables = testDb.db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r: any) => r.name);

const required = ['subscriptions', 'invoices', 'webhook_events', 'audit_history'];
for (const name of required) {
  if (!tables.includes(name)) {
    throw new Error(`Missing required table: ${name}`);
  }
}

const resolver = new PlanStrategyResolver();
resolver.resolve('basic');
resolver.resolve('pro');
console.log('Schema & Plan Strategies validated successfully!');
