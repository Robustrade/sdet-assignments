// Reads the database directly, so the tests can check what is really saved.
// Read-only: the tests only look, they never change data.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Path is relative to this file, so the tests work from any folder.
const DB_FILE = fileURLToPath(new URL('../demo-app/demo.db', import.meta.url));

function readDb(sql, ...params) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

export function subscriptionInDb(subscriptionId) {
  return readDb('SELECT * FROM subscriptions WHERE id = ?', subscriptionId)[0];
}

export function subscriptionsOfCustomerInDb(customerId) {
  return readDb('SELECT * FROM subscriptions WHERE customer_id = ?', customerId);
}

export function paymentsInDb(subscriptionId) {
  return readDb('SELECT * FROM payments WHERE subscription_id = ?', subscriptionId);
}
