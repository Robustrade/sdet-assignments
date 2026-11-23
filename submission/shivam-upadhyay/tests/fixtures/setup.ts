import { createApp, type CreatedApp } from '../../src/app';
import { InMemoryStore } from '../../src/store';
import { ApiClient } from '../api/client';
import { MockPaymentProvider } from '../mocks/mockProvider';
import { WebhookSimulator } from '../mocks/webhookSimulator';

export interface TestClock {
  now: number;
  advance(ms: number): void;
}

export interface TestContext extends CreatedApp {
  mock: MockPaymentProvider;
  api: ApiClient;
  webhooks: WebhookSimulator;
  clock: TestClock;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fresh app + store + mock + controllable clock per test. Runs are isolated. */
export function createTestContext(): TestContext {
  const clock: TestClock = {
    now: Date.now(),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const mock = new MockPaymentProvider();
  const store = new InMemoryStore();
  const created = createApp({ provider: mock, store, now: () => clock.now });
  return {
    ...created,
    mock,
    api: new ApiClient(created.app),
    webhooks: new WebhookSimulator(created.app),
    clock,
  };
}

/** Creates a subscription via the API; throws if creation fails (setup error). */
export async function createSubscription(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await ctx.api.create({
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`setup: create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as Record<string, unknown>;
}

/** Moves the clock past the pro trial (7 days) so the trial is due. */
export function advancePastProTrial(ctx: TestContext): void {
  ctx.clock.advance(8 * DAY_MS);
}

/** Moves the clock past the basic trial (14 days) so the trial is due. */
export function advancePastBasicTrial(ctx: TestContext): void {
  ctx.clock.advance(15 * DAY_MS);
}
