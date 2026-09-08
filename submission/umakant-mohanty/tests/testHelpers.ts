import { TestContext } from '../src/application/testContext';
import { createHmac } from 'node:crypto';

export function sign(body: string): string { return createHmac('sha256', 'test-secret').update(body).digest('hex'); }
export function baseWebhook(subscriptionId: string, overrides: Record<string, any> = {}): any {
  return { event_id: `evt_${Math.random().toString(16).slice(2)}`, type: 'payment.succeeded', subscription_id: subscriptionId, invoice_id: `inv_${Math.random().toString(16).slice(2)}`, amount: 4900, currency: 'USD', ...overrides };
}
export function createContext(): TestContext { const ctx = new TestContext(); ctx.reset(); return ctx; }
