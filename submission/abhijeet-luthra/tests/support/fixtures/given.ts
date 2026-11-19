import { SubscriptionResponse } from '../../../src/http/presenters';
import { aSubscriptionRequest } from '../builders/subscription-request-builder';
import { TestEnvironment } from './test-environment';

/**
 * Scenario shortcuts: put a subscription into a known lifecycle state through
 * the PUBLIC API (never by writing rows), so setup exercises real behavior.
 */
async function create(env: TestEnvironment, plan: 'basic' | 'pro'): Promise<SubscriptionResponse> {
  const res = await env.api.create(aSubscriptionRequest().onPlan(plan).build());
  if (res.status !== 201) throw new Error(`Setup failed: create returned ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** `pro` plan, 7-day trial, no charge yet. */
export const givenTrialingSubscription = (env: TestEnvironment) => create(env, 'pro');

/** `basic` plan, immediate charge succeeded. */
export async function givenActiveSubscription(env: TestEnvironment): Promise<SubscriptionResponse> {
  env.provider.willSucceed();
  return create(env, 'basic');
}

/** `basic` plan, immediate charge declined (attempt 1 failed). */
export async function givenPastDueSubscription(env: TestEnvironment): Promise<SubscriptionResponse> {
  env.provider.willDecline();
  return create(env, 'basic');
}

/** `basic` plan, immediate charge timed out: still trialing, attempt 1 `timed_out`. */
export async function givenTimedOutFirstCharge(env: TestEnvironment): Promise<SubscriptionResponse> {
  env.provider.willTimeout();
  return create(env, 'basic');
}

/** Active, then canceled by the customer. */
export async function givenCanceledSubscription(env: TestEnvironment): Promise<SubscriptionResponse> {
  const sub = await givenActiveSubscription(env);
  const res = await env.api.cancel(sub.id);
  if (res.status !== 200) throw new Error(`Setup failed: cancel returned ${res.status}`);
  return res.body;
}
