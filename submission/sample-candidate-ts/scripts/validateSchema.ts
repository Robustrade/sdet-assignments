/**
 * Sanity-checks that the persisted entity shapes contain every field the
 * assignment's "Required Database Coverage" section expects, by driving a
 * real subscription through the service and inspecting what comes out of
 * the Repository. Run with `npm run validate-schema`.
 */
import { ConsolePaymentProvider } from "../src/payments/ConsolePaymentProvider";
import { Repository } from "../src/persistence/Repository";
import { SubscriptionService } from "../src/service/SubscriptionService";

const REQUIRED_SUBSCRIPTION_FIELDS = [
  "id",
  "customerId",
  "plan",
  "paymentMethodId",
  "status",
  "consecutiveFailures",
  "createdAt",
  "updatedAt",
];

const REQUIRED_INVOICE_FIELDS = [
  "id",
  "subscriptionId",
  "amountCents",
  "currency",
  "status",
  "createdAt",
  "updatedAt",
];

const REQUIRED_AUDIT_FIELDS = ["id", "subscriptionId", "eventType", "detail", "createdAt"];

async function main(): Promise<void> {
  const repository = new Repository();
  const service = new SubscriptionService(repository, new ConsolePaymentProvider());

  const { subscription, invoiceId } = await service.createSubscription({
    customerId: "cust_schema_check",
    plan: "basic",
    paymentMethodId: "pm_schema_check",
  });

  const errors: string[] = [];

  errors.push(...missingFields("subscriptions", subscription, REQUIRED_SUBSCRIPTION_FIELDS));

  const invoice = repository.getInvoice(invoiceId);
  if (!invoice) {
    errors.push("invoices: expected an invoice to exist after subscription creation");
  } else {
    errors.push(...missingFields("invoices", invoice, REQUIRED_INVOICE_FIELDS));
  }

  const auditEvents = repository.listAuditEvents(subscription.id);
  if (auditEvents.length === 0) {
    errors.push("audit_events: expected at least one audit event after subscription creation");
  } else {
    errors.push(...missingFields("audit_events", auditEvents[0], REQUIRED_AUDIT_FIELDS));
  }

  if (errors.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    process.exit(1);
  }

  console.log("OK: subscriptions");
  console.log("OK: invoices");
  console.log("OK: audit_events");
  console.log("Schema validation passed.");
}

function missingFields(entity: string, record: object, required: string[]): string[] {
  const missing = required.filter((field) => !(field in record));
  return missing.length > 0 ? [`${entity}: missing fields ${missing.join(", ")}`] : [];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
