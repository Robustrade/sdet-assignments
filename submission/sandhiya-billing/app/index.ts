import { createApp } from "./api.ts";
import { BillingService } from "./service.ts";

const port = Number(process.env.PORT ?? 3000);
const service = new BillingService({
  dbPath: process.env.BILLING_DB_PATH ?? "billing.db",
  signatureSecret: process.env.PROVIDER_SIGNATURE_SECRET ?? "test-secret",
});
const server = createApp(service);

server.listen(port, () => {
  console.log(`Subscription & Billing Service listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    service.repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
