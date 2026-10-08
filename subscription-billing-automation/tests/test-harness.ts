import { MockPaymentProviderAdapter } from '../src/adapters/mock-payment-provider.adapter';
import { BillingApiClient } from '../framework/clients/billing-api.client';
import { PersistenceVerifier } from '../framework/verifiers/persistence.verifier';
import { SubscriptionBillingService } from '../src/service/subscription-billing.service';

export function createHarness() {
  const provider = new MockPaymentProviderAdapter();
  const service = new SubscriptionBillingService(provider);
  const api = new BillingApiClient(service);
  const verifier = new PersistenceVerifier(service.subscriptions, service.invoices, service.webhookEvents);
  return { provider, service, api, verifier };
}
