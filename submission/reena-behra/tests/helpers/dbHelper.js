// Reads the demo app's database DIRECTLY, so tests can check that what the API
// says matches what is really saved. Read-only: tests never change data here.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const DB_FILE = fileURLToPath(new URL('../../demo-app/demo.db', import.meta.url));

function query(sql, ...params) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

export const getSubscriptionFromDb = (subscriptionId) =>
  query('SELECT * FROM subscriptions WHERE id = ?', subscriptionId)[0];

export const getSubscriptionsOfCustomerFromDb = (customerId) =>
  query('SELECT * FROM subscriptions WHERE customer_id = ?', customerId);

export const getPaymentsFromDb = (subscriptionId) =>
  query('SELECT * FROM payments WHERE subscription_id = ? ORDER BY attempt_no', subscriptionId);

export const getWebhookEventFromDb = (eventId) =>
  query('SELECT * FROM webhook_events WHERE event_id = ?', eventId)[0];

export const getWebhookEventsOfSubscriptionFromDb = (subscriptionId) =>
  query('SELECT * FROM webhook_events WHERE subscription_id = ?', subscriptionId);

// Just the list of statuses, e.g. ['trialing', 'past_due', 'active']
export const getStatusHistoryFromDb = (subscriptionId) =>
  query('SELECT to_status FROM status_history WHERE subscription_id = ? ORDER BY id', subscriptionId).map((row) => row.to_status);
