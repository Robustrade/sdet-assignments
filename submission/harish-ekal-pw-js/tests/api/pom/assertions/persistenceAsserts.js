const { expect } = require('@playwright/test');

function expectSubscriptionStatus(repos, id, status) {
  const sub = repos.subscriptionRepo.getById(id);
  expect(sub).toBeTruthy();
  expect(sub.status).toBe(status);
}

function expectSingleInvoice(repos, invoiceId, status) {
  const invoices = repos.invoiceRepo.findByInvoiceId(invoiceId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].status).toBe(status);
}

function expectWebhookProcessedOnce(repos, eventId) {
  const rows = repos.webhookRepo.all().filter((x) => x.eventId === eventId);
  expect(rows).toHaveLength(2);
  const applied = rows.filter((x) => x.duplicate === false);
  const duplicate = rows.filter((x) => x.duplicate === true);
  expect(applied).toHaveLength(1);
  expect(duplicate).toHaveLength(1);
}

module.exports = {
  expectSubscriptionStatus,
  expectSingleInvoice,
  expectWebhookProcessedOnce,
};
