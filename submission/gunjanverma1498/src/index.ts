import { createApp } from './http/app';
import { defaultPlanCatalog } from './domain/plans';
import type { ChargeRequest, ChargeResult, PaymentProvider } from './payments/PaymentProvider';
import { Database } from './persistence/repositories';
import { BillingService } from './service/BillingService';
import { SystemClock } from './support/clock';
import { generateId } from './support/ids';

/**
 * Composition root. Wires the service with real-ish defaults and starts an HTTP
 * server, so the fixture can be run and poked by hand (`npm run dev`). The
 * automated suite builds its own environment with a fake provider instead — see
 * tests/support/fixtures/TestEnvironment.ts.
 */
class AlwaysApproveProvider implements PaymentProvider {
  async charge(_request: ChargeRequest): Promise<ChargeResult> {
    return { success: true, providerChargeId: generateId('ch') };
  }
}

export function buildSystem(webhookSecret: string) {
  const db = new Database();
  const service = new BillingService({
    db,
    paymentProvider: new AlwaysApproveProvider(),
    plans: defaultPlanCatalog(),
    clock: new SystemClock(),
    webhookSecret,
  });
  return { db, service, app: createApp(service) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const port = Number(process.env.PORT ?? 3000);
  const secret = process.env.WEBHOOK_SECRET ?? 'dev-secret';
  const { db } = startDevServer(port, secret);

  // Seed a demo customer so the running service is immediately usable.
  db.customers.insert({
    id: 'cust_001',
    email: 'demo@example.com',
    paymentMethodIds: ['pm_test_visa_4242'],
  });
}

function startDevServer(port: number, secret: string) {
  const system = buildSystem(secret);
  system.app.listen(port, () => {
    console.log(`Subscription & Billing fixture listening on :${port}`);
  });
  return system;
}
