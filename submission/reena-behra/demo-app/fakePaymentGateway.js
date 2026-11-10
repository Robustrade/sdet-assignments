// A FAKE payment gateway. We never call a real one in tests.
// Like Stripe test cards, the customer's card decides the result:
//   card_ok       -> payment succeeds
//   card_declined -> payment is declined
//   card_timeout  -> gateway does not answer in time (result unknown)

export const gatewayCalls = []; // every call is recorded so tests can check it

export async function chargeCard({ subscriptionId, customerId, card, amount, idempotencyKey }) {
  gatewayCalls.push({ subscriptionId, customerId, card, amount, idempotencyKey });
  await new Promise((resolve) => setTimeout(resolve, 20)); // pretend network delay

  if (card === 'card_ok') return 'success';
  if (card === 'card_declined') return 'declined';
  if (card === 'card_timeout') throw new Error('TIMEOUT');
  throw new Error(`Unknown test card: ${card}`);
}
